import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startHarness, actors } from './harness.mjs';

test('all pages reachable, limits validated, mission and huge threads bounded', { timeout: 60000 }, async t => {
  const h = await startHarness();
  t.after(() => h.close());
  for (let i = 0; i < 63; i++) h.engine.createMission({ title: `Mission ${i}`, description: 'A useful public mission for pagination coverage.', creator: actors.builder });
  let cursor;
  const ids = [];
  do {
    const page = await h.clients.builder.listPage('missions', { limit: 7, cursor });
    assert.ok(page.items.length <= 7);
    ids.push(...page.items.map(item => item.id));
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(new Set(ids).size, 63);
  assert.equal(ids.length, 63);
  let found = [], next;
  do {
    const page = await h.clients.builder.discoverPage('missions', { limit: 9, cursor: next, query: 'pagination' });
    found.push(...page.items.map(item => item.mission.id)); next = page.nextCursor;
  } while (next);
  assert.equal(new Set(found).size, 63);
  for (const suffix of ['?limit=999', '?limit=-1', '?limit=NaN', '?cursor=garbage']) {
    assert.equal((await fetch(`${h.url}/v1/missions${suffix}`)).status, 400);
  }
  const missionId = ids[0];
  let parent;
  for (let i = 0; i < 75; i++) {
    parent = h.engine.postBoardEntry({ missionId, author: actors.builder, type: 'COMMENT', summary: `Nested update ${i}`, ...(parent ? { references: [{ entryId: parent.id, relation: 'REPLIES_TO' }] } : {}) });
    const taskId = randomUUID();
    h.engine.store.tasks.set(taskId, { id: taskId, missionId, key: `step-${i}`, title: `Task ${i}`, objective: 'Produce a verifiable useful result.', acceptanceCriteria: ['Output verified'], mode: 'EXCLUSIVE', status: 'OPEN', createdBy: actors.builder, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  }
  const overview = await h.clients.builder.getMission(missionId);
  assert.equal(overview.tasks.length, 20);
  assert.equal(overview.pagination.tasks.total, 75);
  const tasks = await h.clients.builder.getMissionRecords(missionId, 'tasks', { cursor: overview.pagination.tasks.nextCursor, limit: 20 });
  assert.equal(tasks.items.length, 20);
  assert.ok(!overview.tasks.some(task => tasks.items.some(nextTask => nextTask.id === task.id)));
  const boardIds = [];
  cursor = undefined;
  do {
    const brief = await h.clients.builder.readBoard(missionId, { limit: 10, cursor });
    assert.ok(brief.entries.length <= 10, 'thread expansion cannot bypass the limit');
    boardIds.push(...brief.entries.map(state => state.entry.id)); cursor = brief.nextCursor;
  } while (cursor);
  assert.equal(new Set(boardIds).size, 75);
  const specific = await h.clients.builder.readBoard(missionId, { entryId: parent.id });
  assert.equal(specific.entries.length, 1);
  assert.equal(specific.entries[0].entry.id, parent.id);
  h.engine.store.missions.get(missionId).status = 'ACTIVE';
  const discovered = await h.clients.builder.discoverPage('tasks', { missionId, limit: 12 });
  assert.equal(discovered.items.length, 12);
  assert.ok(discovered.nextCursor);
  const gate = h.engine.openDecisionGate({ missionId, actor: actors.builder, level: 'MISSION', title: 'Paginated review', question: 'Which plan should we choose next?', risk: 'LOW', minIndependentBallots: 1, autoSelect: true });
  const proposal = h.engine.submitDecisionProposal({ gateId: gate.id, proposedBy: actors.builder, title: 'Small follow-up', summary: 'One small follow-up ready for independent review.', tasks: [] });
  for (let i = 0; i < 25; i++) {
    const id = randomUUID();
    h.engine.store.decisionBallots.set(id, { id, gateId: gate.id, missionId, voter: i === 24 ? actors.builder : { id: `agent:${i}`, type: 'agent', displayName: `Agent ${i}` }, rankedProposalIds: [proposal.id], objections: [], rationale: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  }
  const gatePage = await h.clients.builder.getDecisionGate(gate.id);
  assert.equal(gatePage.ballots.length, 20);
  assert.equal(gatePage.pagination.ballots.total, 25);
  assert.equal(gatePage.viewerBallot.voter.id, actors.builder.id);
  assert.equal(gatePage.ranking[0].agentFirstChoices, 25);
});
