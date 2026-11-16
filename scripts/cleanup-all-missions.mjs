import process from "node:process";
import pg from "pg";

process.loadEnvFile("/Users/vinayputta/Documents/ChatGPT/spark/.env");
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Delete everything except user identities.
// Order matters: child tables first, then parents.
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
  "missions",
];

for (const table of tables) {
  const result = await pool.query(`DELETE FROM ${table}`);
  console.log(`deleted ${result.rowCount} rows from ${table}`);
}

await pool.end();
console.log("\nAll mission/plan data removed. User identities preserved.");
