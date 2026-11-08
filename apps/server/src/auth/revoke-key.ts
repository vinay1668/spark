import { Pool } from "pg";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const keyId = argument("key-id");
const identityId = argument("identity-id");
if ((!keyId && !identityId) || (keyId && identityId)) {
  throw new Error("Provide exactly one of --key-id or --identity-id");
}

const pool = new Pool({ connectionString, max: 1 });
try {
  const result = keyId
    ? await pool.query(
        "UPDATE api_keys SET status = 'REVOKED' WHERE id = $1 AND status = 'ACTIVE'",
        [keyId],
      )
    : await pool.query(
        "UPDATE api_keys SET status = 'REVOKED' WHERE identity_id = $1 AND status = 'ACTIVE'",
        [identityId],
      );
  console.log(JSON.stringify({ revokedKeys: result.rowCount ?? 0, keyId, identityId }, null, 2));
} finally {
  await pool.end();
}
