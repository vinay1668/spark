import Fastify from 'fastify';
import { PGlite } from '@electric-sql/pglite';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, extname, join } from 'node:path';
import { CoordinationEngine } from '../../apps/server/dist/domain/engine.js';
import { PostgresPersistence } from '../../apps/server/dist/persistence/postgres.js';
import { registerRoutes } from '../../apps/server/dist/api/routes.js';
import { humanScopes, agentScopes } from '../../apps/server/dist/auth/authenticator.js';
import { SparkClient } from '../../packages/sdk/dist/index.js';

export const actors = {
  owner: { id: 'clerk:test-owner', type: 'human', displayName: 'MossPanda' },
  builder: { id: 'agent:builder', type: 'agent', displayName: 'Builder' },
  reviewer: { id: 'agent:reviewer', type: 'agent', displayName: 'Reviewer' },
  outsider: { id: 'human:outsider', type: 'human', displayName: 'Outsider' },
};

// Only the pg transport is adapted. All SQL, migrations, snapshots and domain logic
// run unchanged on embedded PostgreSQL, in a disposable directory.
export async function startHarness() {
  const directory = await mkdtemp(join(tmpdir(), 'spark-e2e-'));
  let db = new PGlite(directory);
  const pool = {
    async query(sql, params) {
      if (params?.length) return db.query(sql, params);
      const results = await db.exec(sql);
      return results.at(-1) ?? { rows: [] };
    },
    async connect() { return { query: pool.query, release() {} }; },
    async end() {},
  };
  const persistence = new PostgresPersistence(pool);
  await persistence.migrate();
  const engine = new CoordinationEngine();
  const oldLock = process.env.SPARK_PERSISTENCE_MEMORY_LOCK;
  const oldReload = process.env.SPARK_PERSISTENCE_RELOAD_ON_MUTATION;
  process.env.SPARK_PERSISTENCE_MEMORY_LOCK = 'true';
  process.env.SPARK_PERSISTENCE_RELOAD_ON_MUTATION = 'true';
  const app = Fastify();
  registerRoutes(app, engine, {
    async authenticate(header) {
      const name = header?.replace(/^Bearer /, '');
      const actor = actors[name];
      return actor ? { actor, scopes: actor.type === 'agent' ? agentScopes : humanScopes } : null;
    }, async close() {},
  }, { run: (action) => persistence.runAtomically(engine.store, action) });
  const nativeFetch = globalThis.fetch;
  const proofs = new Map();
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url ?? input);
    if (url.origin !== 'https://api.github.com') return nativeFetch(input, init);
    const [, , owner, name] = url.pathname.split('/');
    const fixture = proofs.get(`${owner}/${name}`);
    if (!fixture) return Response.json({ message: 'Not found' }, { status: 404 });
    if (url.pathname.includes('/contents/')) return Response.json({ type: 'file', encoding: 'base64', content: Buffer.from(JSON.stringify(fixture.proof)).toString('base64') });
    return Response.json({ id: fixture.id, name, owner: { login: owner, type: 'User' }, private: false,
      default_branch: 'main', html_url: `https://github.com/${owner}/${name}` });
  };
  // Serve the real built React bundle and forward its /api prefix to the real routes.
  app.all('/api/*', async (request, reply) => {
    const response = await app.inject({ method: request.method, url: request.url.slice(4), headers: request.headers, payload: request.body });
    reply.code(response.statusCode).header('content-type', response.headers['content-type'] ?? 'application/json').send(response.body);
  });
  const dist = resolve('apps/web-react/dist');
  app.get('/*', async (request, reply) => {
    const name = request.url.split('?')[0] === '/' ? '/index.html' : request.url.split('?')[0];
    const file = resolve(dist, `.${name}`);
    if (!file.startsWith(`${dist}/`)) return reply.code(404).send();
    try {
      let data = await readFile(file);
      const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' }[extname(file)] ?? 'application/octet-stream';
      if (file.endsWith('index.html')) {
        // Authentication provider is a fixture; the UI identity/auth code is real.
        data = Buffer.from(data.toString().replace(/<script[^>]*data-clerk-publishable-key=[\s\S]*?<\/script>/, '<script data-clerk-publishable-key="test_fixture"></script>'));
      }
      return reply.type(mime).send(data);
    } catch { return reply.code(404).send(); }
  });
  let url;
  try { url = await app.listen({ host: '127.0.0.1', port: 0 }); }
  catch (error) { await app.close(); await db.close(); globalThis.fetch = nativeFetch; await rm(directory, { recursive: true, force: true }); throw error; }
  return { app, engine, persistence, get db() { return db; }, pool, proofs, url,
    async restartDatabase() { await db.close(); db = new PGlite(directory); },
    clients: Object.fromEntries(Object.keys(actors).map((name) => [name, new SparkClient(url, name)])),
    async close() {
      await app.close(); await db.close(); globalThis.fetch = nativeFetch;
      for (const [key, value] of [['SPARK_PERSISTENCE_MEMORY_LOCK', oldLock], ['SPARK_PERSISTENCE_RELOAD_ON_MUTATION', oldReload]]) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
      await rm(directory, { recursive: true, force: true });
    },
  };
}

export async function addRound(h, missionId, number, parentGateId, dependsOn = []) {
  const { builder } = h.clients;
  const gate = await builder.openDecisionGate(missionId, { level: 'MISSION', title: `Round ${number}`, question: 'What should we deliver in this round?', risk: 'LOW', ...(parentGateId ? { parentGateId } : {}) });
  const proposal = await builder.submitDecisionProposal(gate.id, { title: `Deliver round ${number}`, summary: 'A small independently verifiable improvement.', tasks: [{ key: `round-${number}`, title: `Implement round ${number}`, objective: 'Ship a tested improvement toward the mission goal.', acceptanceCriteria: ['Tests pass and code is reviewed'], mode: 'EXCLUSIVE', dependsOn }] });
  await builder.supportDecisionProposal(gate.id, proposal.id);
  const view = await builder.getMission(missionId);
  return { gate, task: view.tasks.find((task) => task.decisionGateId === gate.id) };
}

export async function finishTask(h, task) {
  const { builder, reviewer } = h.clients;
  const claim = await builder.claimTask(task.id);
  const contribution = await builder.submitContribution({ claimId: claim.id, summary: 'Implemented and tested this round.', evidence: [{ kind: 'CODE', uri: `https://github.com/example/core/pull/${task.key.replace(/\D/g, '') || 1}`, summary: 'Implementation pull request with tests.' }] });
  await reviewer.reviewContribution({ contributionId: contribution.id, verdict: 'PASSED', findings: ['Acceptance criteria verified'], evidence: [{ kind: 'COMMAND', summary: 'Test suite passed.' }] });
  return contribution;
}
