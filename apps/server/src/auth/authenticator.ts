import { createHmac, timingSafeEqual } from "node:crypto";
import { Pool } from "pg";
import { verifyToken } from "@clerk/backend";
import type { Actor } from "@spark/contracts";

export type ApiScope =
  | "mission:create"
  | "decision:create"
  | "decision:propose"
  | "decision:vote"
  | "decision:select"
  | "plan:propose"
  | "plan:approve"
  | "task:claim"
  | "contribution:submit"
  | "review:submit"
  | "human_request:create"
  | "human_request:answer"
  | "delegation:manage"
  | "repository:register"
  | "publication:propose"
  | "publication:decide"
  | "publication:withdraw"
  | "mission:control"
  | "task:control"
  | "plan:reject"
  | "board:write"
  | "board:vote";

export interface AuthContext {
  actor: Actor;
  scopes: ReadonlySet<ApiScope>;
}

export interface Authenticator {
  authenticate(authorizationHeader: string | undefined): Promise<AuthContext | null>;
  reserveDisplayName?(identityId: string, displayName: string): Promise<boolean>;
  close(): Promise<void>;
}

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer ([^\s]+)$/.exec(header);
  return match?.[1] ?? null;
}

function equalText(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export class DisabledAuthenticator implements Authenticator {
  async authenticate(): Promise<null> {
    return null;
  }
  async close(): Promise<void> {}
}

export class DevelopmentAuthenticator implements Authenticator {
  constructor(
    private readonly apiKey: string,
    private readonly actor: Actor,
    private readonly scopes: ReadonlySet<ApiScope>,
  ) {}

  async authenticate(header: string | undefined): Promise<AuthContext | null> {
    const token = bearerToken(header);
    if (!token || !equalText(token, this.apiKey)) return null;
    return { actor: this.actor, scopes: this.scopes };
  }

  async close(): Promise<void> {}
}

interface KeyRow {
  id: string;
  secret_hash: string;
  scopes: ApiScope[];
  expires_at: Date | null;
  identity_id: string;
  actor_type: Actor["type"];
  display_name: string;
}

export class PostgresAuthenticator implements Authenticator {
  private readonly pool: Pool;

  constructor(connectionString: string, private readonly pepper: string) {
    if (Buffer.byteLength(pepper) < 32) {
      throw new Error("SPARK_API_KEY_PEPPER must contain at least 32 bytes");
    }
    this.pool = new Pool({ connectionString, max: 5 });
  }

  async authenticate(header: string | undefined): Promise<AuthContext | null> {
    const token = bearerToken(header);
    if (!token) return null;
    const parsed = /^spk_([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/i.exec(token);
    if (!parsed) return null;
    const [, keyId, secret] = parsed;
    if (!keyId || !secret) return null;

    const query = await this.pool.query<KeyRow>(
      `SELECT k.id, k.secret_hash, k.scopes, k.expires_at,
              i.id AS identity_id, i.actor_type, i.display_name
       FROM api_keys k
       JOIN identities i ON i.id = k.identity_id
       WHERE k.id = $1 AND k.status = 'ACTIVE' AND i.status = 'ACTIVE'`,
      [keyId],
    );
    const row = query.rows[0];
    if (!row || (row.expires_at && row.expires_at.getTime() <= Date.now())) return null;

    const presentedHash = createHmac("sha256", this.pepper).update(secret).digest("hex");
    if (!equalText(presentedHash, row.secret_hash.trim())) return null;

    await this.pool.query("UPDATE api_keys SET last_used_at = now() WHERE id = $1", [keyId]);
    return {
      actor: { id: row.identity_id, type: row.actor_type, displayName: row.display_name },
      scopes: new Set(row.scopes),
    };
  }

  async reserveDisplayName(identityId: string, displayName: string): Promise<boolean> {
    try {
      const result = await this.pool.query(
        "UPDATE identities SET display_name = $1 WHERE id = $2",
        [displayName, identityId],
      );
      return result.rowCount === 1;
    } catch (error: any) {
      if (error?.code === "23505") return false;
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export const agentScopes: ReadonlySet<ApiScope> = new Set([
  "mission:control",
  "mission:create",
  "decision:create",
  "decision:propose",
  "decision:vote",
  "plan:propose",
  "plan:approve",
  "task:claim",
  "contribution:submit",
  "review:submit",
  "human_request:create",
  "repository:register",
  "publication:propose",
  "board:write",
  "board:vote",
]);

export const humanScopes: ReadonlySet<ApiScope> = new Set([
  ...agentScopes,
  "decision:select",
  "human_request:answer",
  "delegation:manage",
  "publication:decide",
  "publication:withdraw",
  "mission:control",
  "task:control",
  "plan:reject",
]);

interface IdentityRow {
  id: string;
  actor_type: Actor["type"];
  display_name: string;
  status: "ACTIVE" | "REVOKED";
}

function clerkDisplayName(payload: {
  firstName?: string;
  lastName?: string;
  username?: string;
  email?: string;
}): string {
  if (payload.username) return payload.username;
  const fullName = [payload.firstName, payload.lastName].filter(Boolean).join(" ").trim();
  if (fullName) return fullName;
  if (payload.email) return payload.email.split("@")[0] ?? payload.email;
  return "Member";
}

export class ClerkAuthenticator implements Authenticator {
  private readonly pool: Pool;

  constructor(connectionString: string, private readonly secretKey: string) {
    this.pool = new Pool({ connectionString, max: 5 });
  }

  async authenticate(header: string | undefined): Promise<AuthContext | null> {
    const token = bearerToken(header);
    if (!token) return null;

    let payload: {
      sub: string;
      firstName?: string;
      lastName?: string;
      username?: string;
      email?: string;
    };
    try {
      payload = await verifyToken(token, { secretKey: this.secretKey }) as typeof payload;
    } catch {
      return null;
    }

    const clerkUserId = payload.sub;
    const identityId = `clerk:${clerkUserId}`;
    const displayName = clerkDisplayName(payload);

    const existing = await this.pool.query<IdentityRow>(
      "SELECT id, actor_type, display_name, status FROM identities WHERE id = $1",
      [identityId],
    );

    let actorType: Actor["type"] = "human";
    if (existing.rows[0]) {
      if (existing.rows[0].status !== "ACTIVE") return null;
      actorType = existing.rows[0].actor_type;
    } else {
      await this.pool.query(
        "INSERT INTO identities (id, actor_type, display_name, status) VALUES ($1, $2, $3, $4)",
        [identityId, actorType, displayName, "ACTIVE"],
      );
    }

    const actor: Actor = { id: identityId, type: actorType, displayName: existing.rows[0]?.display_name || displayName };
    const scopes = actorType === "agent" ? agentScopes : humanScopes;
    return { actor, scopes };
  }

  async reserveDisplayName(identityId: string, displayName: string): Promise<boolean> {
    try {
      const result = await this.pool.query(
        "UPDATE identities SET display_name = $1 WHERE id = $2",
        [displayName, identityId],
      );
      return result.rowCount === 1;
    } catch (error: any) {
      if (error?.code === "23505") return false;
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
