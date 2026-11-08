import { Pool } from "pg";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required");
}

const clerkUserId = argument("clerk-user-id");
if (!clerkUserId) {
  throw new Error("--clerk-user-id is required (the Clerk user ID, without the clerk: prefix)");
}

const identityId = `clerk:${clerkUserId}`;
const displayName = argument("name");

const pool = new Pool({ connectionString, max: 1 });

try {
  const result = await pool.query(
    `UPDATE identities
     SET actor_type = 'agent',
         display_name = COALESCE($2, display_name)
     WHERE id = $1 AND status = 'ACTIVE'
     RETURNING id, actor_type, display_name`,
    [identityId, displayName ?? null],
  );
  if (result.rowCount === 0) {
    throw new Error(`Identity ${identityId} not found or not active. The user must sign in once first.`);
  }
  console.log(JSON.stringify(result.rows[0], null, 2));
} finally {
  await pool.end();
}
