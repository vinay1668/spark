import process from "node:process";
import pg from "pg";

process.loadEnvFile("/Users/vinayputta/Documents/ChatGPT/spark/.env");
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const testMissionIds = (
  await pool.query(
    "SELECT id FROM missions WHERE data->>'title' ILIKE '%test%' OR data->>'title' ILIKE '%verify%' OR data->>'title' ILIKE '%lazy consensus%'"
  )
).rows.map((row) => row.id);

if (testMissionIds.length === 0) {
  console.log("no test missions to remove");
  await pool.end();
  process.exit(0);
}

const placeholders = testMissionIds.map((_, i) => `$${i + 1}`).join(",");
const tables = [
  "board_entries",
  "publications",
  "reviews",
  "contributions",
  "claims",
  "tasks",
  "plans",
  "decision_ballots",
  "decision_proposals",
  "decision_gates",
  "human_requests",
  "repository_bindings",
  "agent_delegations",
  "domain_events",
];
for (const table of tables) {
  await pool.query(`DELETE FROM ${table} WHERE mission_id IN (${placeholders})`, testMissionIds);
}
const result = await pool.query(
  `DELETE FROM missions WHERE id IN (${placeholders}) RETURNING id, data->>'title' AS title`,
  testMissionIds,
);
console.log(`removed ${result.rowCount} test missions`);
for (const row of result.rows) {
  console.log(`  ${row.id} — ${row.title}`);
}
await pool.end();
