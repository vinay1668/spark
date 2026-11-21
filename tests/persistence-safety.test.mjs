import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PostgresPersistence } from '../apps/server/dist/persistence/postgres.js';
import { MemoryStore } from '../apps/server/dist/domain/store.js';
import { configureTestDatabase } from '../apps/server/dist/auth/test-environment.js';
import { SparkApiError } from '../packages/sdk/dist/index.js';

test('test auth rejects production, missing DB and same DB with alternate credentials', () => {
  assert.throws(() => configureTestDatabase({ SPARK_TEST_AUTH: 'true', NODE_ENV: 'production' }), /production/);
  assert.throws(() => configureTestDatabase({ SPARK_TEST_AUTH: 'true' }), /dedicated/);
  assert.throws(() => configureTestDatabase({ SPARK_TEST_AUTH: 'true', DATABASE_URL: 'postgres://user:a@localhost/app', SPARK_TEST_DATABASE_URL: 'postgres://other:b@localhost:5432/app?sslmode=require' }), /differ/);
  const env = { SPARK_TEST_AUTH: 'true', DATABASE_URL: 'postgres://localhost/app', SPARK_TEST_DATABASE_URL: 'postgres://localhost/app_test' };
  configureTestDatabase(env);
  assert.equal(env.DATABASE_URL, env.SPARK_TEST_DATABASE_URL);
});

test('SDK errors expose actionable engine and validation details', () => {
  assert.match(new SparkApiError(409, { message: 'details must be at most 1000 characters' }).message, /details must/);
  assert.match(new SparkApiError(400, { issues: [{ message: 'Missing title' }] }).message, /Missing title/);
});

test('failed database write restores nested memory, inserted records and events', async () => {
  const old = process.env.SPARK_PERSISTENCE_MEMORY_LOCK;
  const reload = process.env.SPARK_PERSISTENCE_RELOAD_ON_MUTATION;
  process.env.SPARK_PERSISTENCE_MEMORY_LOCK = 'true';
  delete process.env.SPARK_PERSISTENCE_RELOAD_ON_MUTATION;
  try {
    const client = { async query(sql) { if (sql === 'COMMIT') throw new Error('disk failure'); }, release() {} };
    const persistence = new PostgresPersistence({ async connect() { return client; } });
    const store = new MemoryStore();
    store.missions.set('one', { id: 'one', title: 'original', creator: { id: 'a' } });
    await assert.rejects(persistence.runAtomically(store, () => {
      store.missions.get('one').creator.id = 'changed';
      store.missions.set('two', { id: 'two' });
      store.events.push({ id: 'failed-event' });
    }), /disk failure/);
    assert.equal(store.missions.get('one').creator.id, 'a');
    assert.equal(store.missions.has('two'), false);
    assert.equal(store.events.length, 0);
  } finally {
    if (old === undefined) delete process.env.SPARK_PERSISTENCE_MEMORY_LOCK; else process.env.SPARK_PERSISTENCE_MEMORY_LOCK = old;
    if (reload === undefined) delete process.env.SPARK_PERSISTENCE_RELOAD_ON_MUTATION; else process.env.SPARK_PERSISTENCE_RELOAD_ON_MUTATION = reload;
  }
});

test('database lock mode refreshes stale stores before decisions', async () => {
  const old = process.env.SPARK_PERSISTENCE_MEMORY_LOCK;
  delete process.env.SPARK_PERSISTENCE_MEMORY_LOCK;
  try {
    const order = [];
    const persistence = new PostgresPersistence({ async connect() { return {
      async query(sql) { order.push(sql); }, release() {},
    }; } });
    persistence.load = async (store) => { order.push('reload'); store.tasks.clear(); store.tasks.set('task', { id: 'task', status: 'CLAIMED' }); };
    const store = new MemoryStore();
    store.tasks.set('task', { id: 'task', status: 'OPEN' });
    await assert.rejects(persistence.runAtomically(store, () => {
      assert.equal(store.tasks.get('task').status, 'CLAIMED');
      throw new Error('already claimed');
    }), /already claimed/);
    assert.ok(order.indexOf('reload') > order.findIndex(sql => sql.includes('pg_advisory')));
    assert.ok(order.includes('ROLLBACK'));
  } finally {
    if (old === undefined) delete process.env.SPARK_PERSISTENCE_MEMORY_LOCK; else process.env.SPARK_PERSISTENCE_MEMORY_LOCK = old;
  }
});
