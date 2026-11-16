import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { fileURLToPath } from "node:url";
import { registerRoutes } from "./api/routes.js";

try { process.loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url))); } catch {}
import {
  agentScopes,
  ClerkAuthenticator,
  DevelopmentAuthenticator,
  DisabledAuthenticator,
  PostgresAuthenticator,
  humanScopes,
  type Authenticator,
} from "./auth/authenticator.js";
import { CoordinationEngine } from "./domain/engine.js";
import { PostgresPersistence } from "./persistence/postgres.js";
import { UploadStore } from "./api/uploads.js";

const isProduction = process.env.NODE_ENV === "production";
const app = Fastify({
  bodyLimit: 1024 * 1024,
  trustProxy: process.env.TRUST_PROXY === "true",
  logger: {
    redact: ["req.headers.authorization", "headers.authorization"],
  },
});

const allowedOrigins = (process.env.SPARK_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
await app.register(cors, {
  origin: allowedOrigins.length === 0
    ? false
    : (origin, callback) => callback(null, !origin || allowedOrigins.includes(origin)),
  credentials: false,
  methods: ["GET", "POST"],
});
await app.register(rateLimit, {
  max: Number(process.env.SPARK_RATE_LIMIT_PER_MINUTE ?? 120),
  timeWindow: "1 minute",
});

const claimTtlSeconds = Number(process.env.SPARK_CLAIM_TTL_SECONDS ?? 900);
const claimSweepSeconds = Number(process.env.SPARK_CLAIM_SWEEP_SECONDS ?? 30);
if (!Number.isSafeInteger(claimTtlSeconds) || claimTtlSeconds < 10) {
  throw new Error("SPARK_CLAIM_TTL_SECONDS must be an integer of at least 10");
}
if (!Number.isSafeInteger(claimSweepSeconds) || claimSweepSeconds < 5) {
  throw new Error("SPARK_CLAIM_SWEEP_SECONDS must be an integer of at least 5");
}
const engine = new CoordinationEngine(undefined, claimTtlSeconds * 1000);
const persistence = process.env.DATABASE_URL
  ? PostgresPersistence.connect(process.env.DATABASE_URL)
  : undefined;

if (persistence) {
  await persistence.migrate();
  await persistence.load(engine.store);
  app.log.info("PostgreSQL persistence enabled");
} else {
  app.log.warn("DATABASE_URL is not set; state will be kept in memory");
}

let authenticator: Authenticator;
if (process.env.DATABASE_URL && process.env.CLERK_SECRET_KEY) {
  const clerk = new ClerkAuthenticator(process.env.DATABASE_URL, process.env.CLERK_SECRET_KEY);
  const keys = process.env.SPARK_API_KEY_PEPPER
    ? new PostgresAuthenticator(process.env.DATABASE_URL, process.env.SPARK_API_KEY_PEPPER)
    : undefined;
  authenticator = {
    authenticate: (header) => /^Bearer spk_/.test(header ?? "")
      ? keys?.authenticate(header) ?? Promise.resolve(null)
      : clerk.authenticate(header),
    reserveDisplayName: (id, name) => clerk.reserveDisplayName(id, name),
    close: async () => { await Promise.all([clerk.close(), keys?.close()]); },
  };
  app.log.info("Clerk authentication enabled");
} else if (process.env.DATABASE_URL && process.env.SPARK_API_KEY_PEPPER) {
  authenticator = new PostgresAuthenticator(
    process.env.DATABASE_URL,
    process.env.SPARK_API_KEY_PEPPER,
  );
  app.log.info("API-key authentication enabled");
} else if (!isProduction && process.env.SPARK_DEV_API_KEY) {
  if (Buffer.byteLength(process.env.SPARK_DEV_API_KEY) < 32) {
    throw new Error("SPARK_DEV_API_KEY must contain at least 32 bytes");
  }
  const actorType = process.env.SPARK_DEV_ACTOR_TYPE === "human" ? "human" : "agent";
  const scopes = new Set(agentScopes);
  if (actorType === "human") {
    for (const scope of humanScopes) scopes.add(scope);
  }
  authenticator = new DevelopmentAuthenticator(
    process.env.SPARK_DEV_API_KEY,
    {
      id: process.env.SPARK_DEV_ACTOR_ID ?? "development-agent",
      type: actorType,
      displayName: process.env.SPARK_DEV_ACTOR_NAME ?? "Development Agent",
    },
    scopes,
  );
  app.log.warn("Development API-key authentication enabled");
} else {
  if (isProduction) {
    throw new Error("Production requires DATABASE_URL and either CLERK_SECRET_KEY or SPARK_API_KEY_PEPPER");
  }
  authenticator = new DisabledAuthenticator();
  app.log.warn("No authentication configured; mutation requests will be rejected");
}

const uploads = persistence ? new UploadStore(persistence.db) : undefined;
registerRoutes(
  app,
  engine,
  authenticator,
  persistence
    ? { run: <T>(action: () => T) => persistence.runAtomically(engine.store, action) }
    : undefined,
  uploads,
);

let coordinationSweepRunning = false;
const coordinationSweep = setInterval(async () => {
  if (coordinationSweepRunning) return;
  coordinationSweepRunning = true;
  try {
    if (persistence) {
      // Fast path: only acquire the global lock if there is work to do.
      const nowMs = Date.now();
      const hasExpiringClaims = [...engine.store.claims.values()].some(
        (claim) => claim.status === "ACTIVE" && claim.expiresAt && Date.parse(claim.expiresAt) <= nowMs,
      );
      const hasExpiringRequests = [...engine.store.humanRequests.values()].some(
        (request) => request.status === "OPEN" && request.expiresAt && Date.parse(request.expiresAt) <= nowMs,
      );
      const hasGateWork = [...engine.store.decisionGates.values()].some((gate) =>
        gate.decisionModel !== "AGENT_QUORUM"
        && ["PROPOSING", "REVIEWING", "AWAITING_HUMAN"].includes(gate.status)
      );
      if (hasExpiringClaims || hasExpiringRequests || hasGateWork) {
        await persistence.runAtomically(engine.store, () => {
          engine.expireClaims();
          engine.expireHumanRequests();
          engine.advanceDecisionGates();
        });
      }
    } else {
      engine.expireClaims();
      engine.expireHumanRequests();
      engine.advanceDecisionGates();
    }
  } catch (error) {
    app.log.error(error, "Coordination deadline sweep failed");
  } finally {
    coordinationSweepRunning = false;
  }
}, claimSweepSeconds * 1000);
coordinationSweep.unref();

app.addHook("onClose", async () => {
  clearInterval(coordinationSweep);
  await authenticator.close();
  await persistence?.close();
});

const port = Number(process.env.PORT ?? 4010);
const host = process.env.HOST ?? "127.0.0.1";

await app.listen({ port, host });
