import test from 'node:test';
import assert from 'node:assert/strict';
import { CoordinationEngine } from '../apps/server/dist/domain/engine.js';
import { buildAgentWorkBrief } from '../apps/server/dist/domain/agent-work-brief.js';

const a = { id: 'agent:a', type: 'agent', displayName: 'A' };
const b = { id: 'agent:b', type: 'agent', displayName: 'B' };
function setup() {
  const engine = new CoordinationEngine();
  const mission = engine.createMission({ creator: a, title: 'Useful shared project', description: 'Produce evidence-backed work together.' });
  const gate = engine.openDecisionGate({ missionId: mission.id, actor: a, level: 'MISSION', title: 'First increment', question: 'What should we deliver together?', risk: 'LOW', minIndependentBallots: 1, autoSelect: true });
  const proposal = engine.submitDecisionProposal({ gateId: gate.id, proposedBy: a, title: 'Small useful increment', summary: 'Complete two tasks with evidence and review.', tasks: [
    { key: 'first', title: 'First task', objective: 'Produce one independently reviewable result.', acceptanceCriteria: ['Evidence is reproducible'], mode: 'EXCLUSIVE', tags: [], requiredCapabilities: [] },
    { key: 'second', title: 'Second task', objective: 'Build on the verified first result.', acceptanceCriteria: ['Evidence is reproducible'], mode: 'EXCLUSIVE', tags: [], requiredCapabilities: [], dependsOn: ['first'] },
  ] });
  engine.submitDecisionBallot({ gateId: gate.id, voter: a, rankedProposalIds: [proposal.id], rationale: '', objections: [] });
  return { engine, mission, tasks: engine.missionView(mission.id).tasks };
}

test('brief prioritizes independent review and excludes self review and blocked dependencies', () => {
  const { engine, mission, tasks } = setup();
  const first = tasks.find(t => t.key === 'first');
  const brief = () => buildAgentWorkBrief(engine.store, mission, b);
  assert.deepEqual(brief().availableTasks.map(t => t.taskId), [first.id]);
  const claim = engine.claimTask(first.id, a);
  assert.equal(buildAgentWorkBrief(engine.store, mission, a).nextAction, 'RESUME');
  const contribution = engine.submitContribution({ claimId: claim.id, author: a, summary: 'Delivered a concrete result', evidence: [{ kind: 'COMMAND', summary: 'Reproducible output' }] });
  assert.equal(brief().nextAction, 'REVIEW');
  assert.equal(brief().pendingReviews[0].contributionId, contribution.id);
  assert.equal(buildAgentWorkBrief(engine.store, mission, a).pendingReviews.length, 0);
  engine.reviewContribution({ contributionId: contribution.id, reviewer: b, verdict: 'PASSED', findings: ['Verified acceptance criteria'], evidence: [{ kind: 'COMMAND', summary: 'Independently reproduced output' }] });
  assert.equal(brief().pendingReviews.length, 0);
  assert.equal(brief().availableTasks[0].key, 'second');
  const future = buildAgentWorkBrief(engine.store, mission, b, '2099-01-01T00:00:00.000Z');
  assert.equal(future.recentChanges.length, 0);
});

test('duplicate agent posts are suppressed but changes and other authors are retained', () => {
  const { engine, mission } = setup();
  const input = { missionId: mission.id, author: a, type: 'HANDOFF', summary: 'Useful task handoff', details: 'Result and next action', evidence: [], tags: [] };
  const first = engine.postBoardEntry(input);
  assert.equal(engine.postBoardEntry(input).id, first.id);
  assert.notEqual(engine.postBoardEntry({ ...input, evidence: [{ kind: 'COMMAND', summary: 'New evidence' }] }).id, first.id);
  assert.notEqual(engine.postBoardEntry({ ...input, author: b }).id, first.id);
  assert.notEqual(engine.postBoardEntry({ ...input, references: [{ entryId: first.id, relation: 'REPLIES_TO' }] }).id, first.id);
});
