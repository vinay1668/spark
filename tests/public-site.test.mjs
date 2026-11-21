import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { resolve } from 'node:path';
import { CoordinationEngine } from '../apps/server/dist/domain/engine.js';
import { registerPublicSite } from '../apps/server/dist/public-site.js';

test('production site has crawlable escaped content, agent discovery, assets and real 404s', async t => {
  const app = Fastify({ rewriteUrl: request => request.url.startsWith('/api/') ? request.url.slice(4) : request.url });
  t.after(() => app.close());
  app.get('/v1/check', async () => ({ ok: true }));
  const engine = new CoordinationEngine();
  const mission = engine.createMission({ title: '<script>alert("x")</script>', description: 'Use agents to deliver useful verified work.', creator: { id: 'agent:one', type: 'agent', displayName: 'Builder' } });
  await registerPublicSite(app, engine, resolve('apps/web-react/dist'), 'https://spark.example');
  const home = await app.inject('/');
  assert.equal(home.statusCode, 200);
  assert.match(home.body, /rel="canonical" href="https:\/\/spark.example\/"/);
  assert.match(home.body, /application\/ld\+json/);
  assert.match(home.body, /<h1>Build useful work/);
  const listing = await app.inject('/missions');
  assert.match(listing.body, new RegExp(`/missions/${mission.id}`));
  const page = await app.inject(`/missions/${mission.id}`);
  assert.match(page.body, /&lt;script&gt;/);
  assert.ok(!page.body.includes('<script>alert("x")</script>'));
  assert.equal((await app.inject('/missions/does-not-exist')).statusCode, 404);
  assert.equal((await app.inject('/.env')).statusCode, 404);
  assert.equal((await app.inject('/assets/missing.js')).statusCode, 404);
  assert.deepEqual((await app.inject('/api/v1/check')).json(), { ok: true });
  assert.match((await app.inject('/robots.txt')).body, /Sitemap: https:\/\/spark.example/);
  assert.match((await app.inject('/sitemap.xml')).body, /<urlset/);
  assert.match((await app.inject('/llms.txt')).body, /nextCursor/);
  const capabilities = (await app.inject('/.well-known/agent-capabilities.json')).json();
  assert.equal(capabilities.mcp.transport, 'stdio');
  assert.equal(capabilities.api.baseUrl, 'https://spark.example');
  const asset = home.body.match(/src="(\/assets\/[^\"]+\.js)"/)[1];
  assert.equal((await app.inject(asset)).statusCode, 200);
});

test('preview without canonical origin is not accidentally indexed', async t => {
  const app = Fastify(); t.after(() => app.close());
  await registerPublicSite(app, new CoordinationEngine(), resolve('apps/web-react/dist'));
  assert.match((await app.inject('/robots.txt')).body, /Disallow: \/\n/);
  assert.match((await app.inject('/')).body, /name="robots" content="noindex"/);
});
