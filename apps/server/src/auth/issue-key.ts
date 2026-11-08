import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { agentScopes, humanScopes, type ApiScope } from "./authenticator.js";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const connectionString = process.env.DATABASE_URL;
const pepper = process.env.SPARK_API_KEY_PEPPER;
if (!connectionString || !pepper) {
  throw new Error("DATABASE_URL and SPARK_API_KEY_PEPPER are required");
}
if (Buffer.byteLength(pepper) < 32) {
  throw new Error("SPARK_API_KEY_PEPPER must contain at least 32 bytes");
}

const identityId = argument("id") ?? `agent_${randomUUID()}`;
const displayName = argument("name");
if (!displayName) throw new Error("--name is required");
const actorType = argument("type") ?? "agent";
if (actorType !== "agent" && actorType !== "human") throw new Error("--type must be agent or human");
const allowedScopes = actorType === "human" ? humanScopes : agentScopes;
const requestedScopes = argument("scopes")?.split(",").filter(Boolean) ?? [];
if (requestedScopes.some((scope) => !allowedScopes.has(scope as ApiScope))) {
  throw new Error(`One or more requested scopes are not allowed for ${actorType} identities`);
}
const scopes = requestedScopes.length > 0 ? requestedScopes as ApiScope[] : [...allowedScopes];
const expiresInDays = Number(argument("expires-days") ?? "90");
if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 365) {
  throw new Error("--expires-days must be an integer from 1 to 365");
}

const keyId = randomUUID();
const secret = randomBytes(32).toString("base64url");
const hash = createHmac("sha256", pepper).update(secret).digest("hex");
const token = `spk_${keyId}.${secret}`;
const pool = new Pool({ connectionString, max: 1 });

try {
  const migration = await readFile(new URL("../../migrations/001_initial.sql", import.meta.url), "utf8");
  await pool.query(migration);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const identityResult = await client.query(
      `INSERT INTO identities (id, actor_type, display_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name
       WHERE identities.status = 'ACTIVE' AND identities.actor_type = EXCLUDED.actor_type
       RETURNING id`,
      [identityId, actorType, displayName],
    );
    if (identityResult.rowCount !== 1) {
      throw new Error("Identity exists with another type or has been revoked");
    }
    await client.query(
      `INSERT INTO api_keys (id, identity_id, secret_hash, scopes, expires_at)
       VALUES ($1, $2, $3, $4, now() + ($5 * interval '1 day'))`,
      [keyId, identityId, hash, scopes, expiresInDays],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}

console.log(JSON.stringify({
  keyId,
  identityId,
  actorType,
  displayName,
  apiKey: token,
  scopes,
  expiresInDays,
  warning: "Copy this key now. Spark stores only its hash and cannot show it again.",
}, null, 2));
