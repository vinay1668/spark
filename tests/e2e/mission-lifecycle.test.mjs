import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { MemoryStore } from '../../apps/server/dist/domain/store.js';
import { CoordinationEngine } from '../../apps/server/dist/domain/engine.js';
import { startHarness, actors, addRound, finishTask } from './harness.mjs';

const rejects = (status) => (error) => error.status === status;
test('multi-year mission: HTTP + SDK + SQL persistence + MCP', { timeout: 90000 }, async (t) => {
  const h = await startHarness();
  t.after(() => h.close());
  const { owner, builder, reviewer, outsider } = h.clients;
  const mission = await owner.createMission({ title: 'Long-running product', description: 'Build a product through many planning rounds and releases.' });
  const id = mission.id;
  await assert.rejects(owner.completeMission(id, 'Not ready yet'), rejects(409));
  await assert.rejects(outsider.completeMission(id, 'Pretend to own it'), rejects(409));
  const anonymous = await fetch(`${h.url}/v1/missions/${id}/complete`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'Spoof ownership', actor: actors.owner }) });
  assert.equal(anonymous.status, 401);

  const repository = (name) => ({ kind: 'EXISTING', owner: 'example', repository: name, sponsorType: 'HUMAN', sponsorDisplayName: 'Example' });
  h.proofs.set('example/core', { id: 101, proof: { missionId: id, registeredBy: actors.owner.id } });
  h.proofs.set('example/docs', { id: 102, proof: { missionId: id, registeredBy: actors.owner.id } });
  h.proofs.set('example/wrong', { id: 103, proof: { missionId: randomUUID(), registeredBy: actors.owner.id } });
  await assert.rejects(owner.registerRepository(id, repository('wrong')), rejects(422));
  await owner.registerRepository(id, repository('core'));
  await owner.registerRepository(id, repository('docs'));
  await assert.rejects(owner.registerRepository(id, repository('core')), rejects(409));
  const linked = (await owner.getMissionProgress(id)).repositories;
  assert.equal(linked.length, 2);
  assert.equal((await owner.getMission(id)).mission.repositoryUrl, 'https://github.com/example/core');
  await h.persistence.migrate(); // Repeated startup must preserve the new multi-repo index.
  await assert.rejects(h.pool.query('INSERT INTO repository_bindings (id, mission_id, status, data) VALUES ($1, $2, $3, $4)', [randomUUID(), id, 'VERIFIED', JSON.stringify(linked[0])]), /unique|duplicate/i);

  let round = await addRound(h, id, 1);
  await assert.rejects(owner.completeMission(id, 'Still has work'), rejects(409));
  await finishTask(h, round.task);
  let progress = await owner.getMissionProgress(id);
  assert.equal(progress.mission.status, 'ACTIVE');
  assert.equal(progress.canComplete, true);
  assert.equal(progress.nextAction, 'PLAN');
  assert.equal(progress.codeEvidence[0].status, 'ACCEPTED');
  assert.equal(progress.codeEvidence[0].repositoryId, linked[0].id);

  const delegation = await owner.grantDelegation(id, { agentId: actors.builder.id, agentDisplayName: actors.builder.displayName });
  const release = await builder.proposePublication(id, { title: 'First release', version: '1.0.0', summary: 'Ship the first verified increment.', artifactUri: 'https://github.com/example/core/releases/tag/v1.0.0', evidence: [{ kind: 'CODE', summary: 'Verified implementation', uri: 'https://github.com/example/core/pull/1' }], capabilities: ['core'] });
  await owner.decidePublication(release.id, { verdict: 'PUBLISHED', reason: 'Verified release ready for use.' });
  assert.equal((await owner.getMissionProgress(id)).mission.status, 'ACTIVE');

  for (let n = 2; n <= 9; n++) {
    round = await addRound(h, id, n, round.gate.id, [`round-${n - 1}`]);
    assert.equal(round.task.status, 'OPEN', 'verified work from the earlier round unlocks later work');
    if (n === 9) {
      const help = await builder.requestHumanHelp({ missionId: id, taskId: round.task.id, kind: 'DECISION', blocking: true, question: 'Is the final scope correct?', reason: 'Confirm the remaining scope.' });
      assert.equal((await owner.getMissionProgress(id)).canComplete, false);
      await assert.rejects(owner.completeMission(id, 'Not resolved'), rejects(409));
      await owner.answerHumanRequest(help.id, 'Yes, implement the agreed scope.');
    }
    await finishTask(h, round.task);
  }
  await h.persistence.runAtomically(h.engine.store, () => h.engine.advanceDecisionGates('2036-11-14T00:00:00.000Z'));
  progress = await owner.getMissionProgress(id);
  assert.equal(progress.mission.status, 'ACTIVE');
  assert.equal(progress.counts.verified, 9);
  assert.equal(progress.directions.length, 5);
  assert.equal(progress.codeEvidence.length, 8);
  assert.equal(progress.latestRelease.version, '1.0.0');

  const gate = await builder.openDecisionGate(id, { level: 'MISSION', title: 'Final decision', question: 'Should we record the final handoff?', risk: 'LOW' });
  await assert.rejects(owner.completeMission(id, 'Still planning'), rejects(409));
  const proposal = await builder.submitDecisionProposal(gate.id, { title: 'Record handoff', summary: 'No new tasks needed for this decision.', tasks: [] });
  await builder.supportDecisionProposal(gate.id, proposal.id);
  await assert.rejects(reviewer.completeMission(id, 'No authority'), rejects(409));
  await owner.revokeDelegation(id, delegation.id);
  await assert.rejects(builder.completeMission(id, 'Authority revoked'), rejects(409));
  await owner.completeMission(id, 'All mission goals verified across nine rounds.');
  await assert.rejects(builder.openDecisionGate(id, { level: 'MISSION', title: 'Sneak new work', question: 'Can an outsider silently reopen?', risk: 'LOW' }), rejects(409));
  await assert.rejects(outsider.reopenMission(id, 'No authority'), rejects(409));
  await assert.rejects(owner.completeMission(id, 'Already complete'), rejects(409));

  await h.restartDatabase();
  const loaded = new MemoryStore();
  await h.persistence.load(loaded);
  const restarted = new CoordinationEngine(loaded).missionProgress(id);
  assert.equal(restarted.mission.status, 'COMPLETED');
  assert.equal(restarted.mission.completion.actor.id, actors.owner.id);
  assert.equal(restarted.repositories.length, 2);
  assert.equal(restarted.counts.verified, 9);

  const mcp = new Client({ name: 'spark-e2e', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('packages/mcp/dist/server.js')], env: { SPARK_API_URL: h.url, SPARK_API_KEY: 'owner' }, stderr: 'pipe' });
  await mcp.connect(transport);
  try {
    const tools = await mcp.listTools();
    for (const name of ['spark_get_mission_progress', 'spark_complete_mission', 'spark_reopen_mission', 'spark_register_repository']) assert.ok(tools.tools.some((tool) => tool.name === name), name);
    const call = async (name, args) => {
      const result = await mcp.callTool({ name, arguments: args });
      assert.ok(!result.isError, JSON.stringify(result));
      return JSON.parse(result.content[0].text);
    };
    assert.equal((await call('spark_get_mission_progress', { missionId: id })).mission.status, 'COMPLETED');
    assert.equal((await call('spark_reopen_mission', { missionId: id, reason: 'Start another year of improvements.' })).status, 'ACTIVE');
    assert.equal((await call('spark_complete_mission', { missionId: id, reason: 'Confirm the achieved goal again.' })).status, 'COMPLETED');
  } finally { await mcp.close(); }
  await owner.reopenMission(id, 'Continue product development.');
  assert.equal((await owner.getMissionProgress(id)).mission.completion, undefined);
  const next = await addRound(h, id, 10, round.gate.id, ['round-9']);
  assert.equal(next.task.status, 'OPEN');
  assert.equal((await owner.getMission(id)).publications[0].status, 'PUBLISHED');
  console.log('Verified: 10 planning rounds, multiple repos, migration rerun, SQL uniqueness, restart reload, publication, explicit completion/reopen, auth rejection, bounded progress and real MCP calls.');
});

test('cancelled rounds stay open; agent owners can finish; unsafe evidence is excluded', { timeout: 30000 }, async (t) => {
  const h = await startHarness();
  t.after(() => h.close());
  const { owner, builder, reviewer } = h.clients;
  const mission = await owner.createMission({ title: 'Cancelled first approach', description: 'A cancelled approach must not abandon the entire mission.' });
  const first = await addRound(h, mission.id, 1);
  await owner.cancelTask(first.task.id, 'Use a better approach next round.');
  let progress = await owner.getMissionProgress(mission.id);
  assert.equal(progress.mission.status, 'ACTIVE');
  assert.equal(progress.nextAction, 'PLAN');
  assert.equal(progress.canComplete, false);
  const second = await addRound(h, mission.id, 2, first.gate.id);
  await finishTask(h, second.task);
  await owner.completeMission(mission.id, 'The replacement approach achieved the goal.');

  const agentMission = await builder.createMission({ title: 'Agent owned goal', description: 'An agent owner can explicitly finish their own mission.' });
  const round = await addRound(h, agentMission.id, 1);
  const claim = await builder.claimTask(round.task.id);
  const contribution = await builder.submitContribution({ claimId: claim.id, summary: 'Evidence filtering regression.', evidence: [
    { kind: 'CODE', uri: 'javascript:alert(1)', summary: 'Never render executable URLs' },
    { kind: 'CODE', uri: 'https://user:secret@example.org/result', summary: 'Never render embedded credentials' },
    { kind: 'CODE', uri: 'https://example.org/result', summary: 'A safe external evidence link' },
  ] });
  await reviewer.reviewContribution({ contributionId: contribution.id, verdict: 'PASSED', findings: ['Reviewed'], evidence: [{ kind: 'COMMAND', summary: 'Passed tests' }] });
  progress = await builder.getMissionProgress(agentMission.id);
  assert.deepEqual(progress.codeEvidence.map((item) => item.uri), ['https://example.org/result']);
  assert.equal(progress.codeEvidence[0].repositoryId, undefined);
  await builder.completeMission(agentMission.id, 'Agent-owned goal achieved.');
  assert.equal((await builder.getMissionProgress(agentMission.id)).mission.status, 'COMPLETED');
});
