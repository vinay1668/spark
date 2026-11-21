import { CoordinationEngine } from "../apps/server/dist/domain/engine.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const human = { id: "human:owner", type: "human", displayName: "Owner" };
const agentA = { id: "agent:a", type: "agent", displayName: "Agent A" };
const agentB = { id: "agent:b", type: "agent", displayName: "Agent B" };
const agentC = { id: "agent:c", type: "agent", displayName: "Agent C" };

const engine = new CoordinationEngine(undefined, 60_000);
const mission = engine.createMission({
  title: "Agent quorum test",
  description: "Verify agent-first consensus without timers or human approval.",
  creator: human,
});

engine.setAgentInterest(mission.id, agentB, "JOIN");
engine.setAgentInterest(mission.id, agentC, "JOIN");
const gate = engine.openDecisionGate({
  missionId: mission.id,
  actor: agentA,
  level: "MISSION",
  title: "Choose a plan",
  question: "Which plan should the agents execute?",
  risk: "LOW",
  minIndependentBallots: 1,
  autoSelect: true,
});

const proposal = engine.submitDecisionProposal({
  gateId: gate.id,
  proposedBy: agentA,
  title: "Plan A",
  summary: "Use the smallest safe implementation.",
  tasks: [],
});

const opened = engine.decisionGateView(gate.id);
assert(opened.gate.decisionModel === "AGENT_QUORUM", "new gates must use agent quorum");
assert(opened.interestedAgentCount === 3, "quorum must snapshot all opted-in agents");
assert(opened.requiredApprovals === 2, "three agents require two approvals");
assert(opened.gate.minIndependentBallots === opened.requiredApprovals, "legacy threshold must mirror authoritative quorum");
assert(opened.gate.status === "REVIEWING", "first proposal should open review immediately");

engine.advanceDecisionGates(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString());
assert(engine.decisionGate(gate.id).status === "REVIEWING", "future time must not advance an agent gate");

engine.submitDecisionBallot({
  gateId: gate.id,
  voter: agentB,
  rankedProposalIds: [],
  rationale: "Advisory concern without approval.",
  objections: [{ proposalId: proposal.id, reason: "Please record the recovery procedure." }],
});
assert(engine.decisionGate(gate.id).status === "REVIEWING", "an objection alone must never count as approval");

engine.submitDecisionBallot({
  gateId: gate.id,
  voter: agentB,
  rankedProposalIds: [proposal.id],
  rationale: "The plan is clear.",
  objections: [],
});
assert(engine.decisionGate(gate.id).status === "REVIEWING", "one approval must not meet quorum");

engine.submitDecisionBallot({
  gateId: gate.id,
  voter: agentC,
  rankedProposalIds: [proposal.id],
  rationale: "The plan is executable.",
  objections: [],
});
assert(engine.decisionGate(gate.id).status === "SELECTED", "any two available agents should satisfy quorum");
assert(engine.decisionGate(gate.id).selectedProposalId === proposal.id, "the approved proposal must be selected");

engine.setAgentInterest(mission.id, agentC, "LEAVE");
const finalView = engine.decisionGateView(gate.id);
assert(finalView.interestedAgentCount === 2, "current interest count should reflect explicit leave");
assert(finalView.requiredApprovals === 2, "the opened gate quorum must remain frozen");

console.log("All agent quorum checks passed.");
