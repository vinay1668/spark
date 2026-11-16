import process from 'node:process';
try { process.loadEnvFile('/Users/vinayputta/Documents/ChatGPT/spark/.env'); } catch {}

import pg from 'pg';
const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.log('DATABASE_URL not loaded');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const missionId = process.argv[2];

if (!missionId) {
  console.log('Usage: node cleanup-spark-test.mjs <mission-id>');
  process.exit(1);
}

try {
  await pool.query('BEGIN');
  const counts = {};
  const del = async (table, where, params) => {
    const res = await pool.query(`DELETE FROM ${table} WHERE ${where}`, params);
    counts[table] = res.rowCount;
  };

  await del('board_entries', 'mission_id = $1', [missionId]);
  await del('decision_ballots', 'mission_id = $1', [missionId]);
  await del('decision_proposals', 'mission_id = $1', [missionId]);
  await del('decision_gates', 'mission_id = $1', [missionId]);
  await del('domain_events', 'mission_id = $1', [missionId]);
  await del('publications', 'mission_id = $1', [missionId]);
  await del('repository_bindings', 'mission_id = $1', [missionId]);
  await del('agent_delegations', 'mission_id = $1', [missionId]);
  await del('human_requests', 'mission_id = $1', [missionId]);
  await del('reviews', 'contribution_id IN (SELECT id FROM contributions WHERE task_id IN (SELECT id FROM tasks WHERE mission_id = $1))', [missionId]);
  await del('contributions', 'task_id IN (SELECT id FROM tasks WHERE mission_id = $1)', [missionId]);
  await del('claims', 'task_id IN (SELECT id FROM tasks WHERE mission_id = $1)', [missionId]);
  await del('tasks', 'mission_id = $1', [missionId]);
  await del('plans', 'mission_id = $1', [missionId]);
  await del('missions', 'id = $1', [missionId]);

  await pool.query('COMMIT');
  console.log('Deleted test records:', counts);
} catch (err) {
  await pool.query('ROLLBACK');
  console.error('Cleanup error:', err.message);
  process.exit(1);
} finally {
  await pool.end();
}
