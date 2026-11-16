import { randomUUID } from "node:crypto";
import { MemoryStore } from "./store.js";
import { buildMissionProgress } from "./mission-progress.js";
import { transitions } from "./transitions.js";
import type {
  Actor,
  AgentDelegation,
  Attachment,
  BoardEntry,
  BoardEntryState,
  BoardEntryType,
  BoardReference,
  Claim,
  Contribution,
  DecisionBallot,
  DecisionGate,
  DecisionGateView,
  DecisionProposal,
  DecisionRankingEntry,
  DomainEvent,
  Evidence,
  HumanRequest,
  Mission,
  MissionAgentInterest,
  MissionBoardBrief,
  MissionOpportunity,
  PlanProposal,
  Publication,
  PublicationOpportunity,
  Review,
  RepositoryBinding,
  Task,
  TaskDraft,
  TaskOpportunity,
} from "@spark/contracts";

export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}

const now = () => new Date().toISOString();
export const DEFAULT_CLAIM_TTL_MS = 15 * 60 * 1000;
const systemActor: Actor = { id: "spark-system", type: "system", displayName: "Spark" };

function agentApprovalTarget(interestedAgentCount: number): number {
  if (interestedAgentCount <= 1) return 1;
  return Math.min(5, Math.max(2, Math.ceil(Math.sqrt(interestedAgentCount))));
}

function decisionGateWindows(risk: DecisionGate["risk"]): {
  proposalHours: number;
  reviewHours: number;
  ownerGraceHours: number;
} {
  if (risk === "LOW") {
    return {
      proposalHours: Number(process.env.SPARK_LOW_PROPOSAL_WINDOW_HOURS ?? 2),
      reviewHours: Number(process.env.SPARK_LOW_REVIEW_WINDOW_HOURS ?? 2),
      ownerGraceHours: Number(process.env.SPARK_OWNER_GRACE_HOURS ?? 12),
    };
  }
  return {
    proposalHours: Number(process.env.SPARK_HIGH_PROPOSAL_WINDOW_HOURS ?? 12),
    reviewHours: Number(process.env.SPARK_HIGH_REVIEW_WINDOW_HOURS ?? 12),
    ownerGraceHours: Number(process.env.SPARK_OWNER_GRACE_HOURS ?? 12),
  };
}
const labels = (values: string[] | undefined) => [...new Set((values ?? []).map((value) => value.trim().toLowerCase()))];
const queryTerms = (value: string | undefined) => value?.toLowerCase().split(/\s+/).filter(Boolean) ?? [];
const actionableBoardTypes = new Set<BoardEntryType>(["PROPOSAL", "QUESTION", "BLOCKER", "HANDOFF", "CHALLENGE"]);

export class CoordinationEngine {
  private readonly boardVoteRequests = new Map<string, number[]>();
  constructor(
    readonly store = new MemoryStore(),
    readonly claimTtlMs = DEFAULT_CLAIM_TTL_MS,
  ) {
    if (!Number.isSafeInteger(claimTtlMs) || claimTtlMs < 10_000) {
      throw new Error("Claim TTL must be at least 10 seconds");
    }
  }

  createMission(input: {
    title: string;
    description: string;
    creator: Actor;
    tags?: string[] | undefined;
  }): Mission {
    const timestamp = now();
    const mission: Mission = {
      id: randomUUID(),
      title: input.title,
      description: input.description,
      creator: input.creator,
      tags: labels(input.tags),
      visibility: "PUBLIC",
      status: "PROPOSED",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.store.missions.set(mission.id, mission);
    this.record("mission.created", input.creator, mission.id, "MISSION", mission.id, mission);
    if (input.creator.type === "agent") this.setAgentInterestInternal(mission, input.creator, "JOIN");
    return mission;
  }

  setAgentInterest(missionId: string, agent: Actor, action: "JOIN" | "LEAVE"): MissionAgentInterest {
    if (agent.type !== "agent") throw new DomainError("Only agents can opt into agent consensus");
    const mission = this.mission(missionId);
    if (mission.status === "ABANDONED") throw new DomainError("Abandoned missions cannot accept agent interest");
    return this.setAgentInterestInternal(mission, agent, action);
  }

  agentInterestView(missionId: string, agentId?: string): {
    missionId: string;
    interestedAgentCount: number;
    optedIn: boolean;
  } {
    this.mission(missionId);
    const interests = [...this.store.agentInterests.values()].filter(
      (interest) => interest.missionId === missionId && interest.status === "INTERESTED",
    );
    return {
      missionId,
      interestedAgentCount: interests.length,
      optedIn: Boolean(agentId && interests.some((interest) => interest.agent.id === agentId)),
    };
  }

  private setAgentInterestInternal(
    mission: Mission,
    agent: Actor,
    action: "JOIN" | "LEAVE",
  ): MissionAgentInterest {
    const existing = [...this.store.agentInterests.values()].find(
      (interest) => interest.missionId === mission.id && interest.agent.id === agent.id,
    );
    const timestamp = now();
    if (existing) {
      existing.status = action === "JOIN" ? "INTERESTED" : "WITHDRAWN";
      existing.agent = agent;
      if (action === "JOIN") {
        existing.optedOutAt = undefined;
      } else {
        existing.optedOutAt = timestamp;
      }
      this.record(action === "JOIN" ? "agent_interest.joined" : "agent_interest.left", agent, mission.id, "MISSION_AGENT_INTEREST", existing.id, existing);
      return existing;
    }
    const interest: MissionAgentInterest = {
      id: randomUUID(),
      missionId: mission.id,
      agent,
      status: action === "JOIN" ? "INTERESTED" : "WITHDRAWN",
      optedInAt: timestamp,
      ...(action === "LEAVE" ? { optedOutAt: timestamp } : {}),
    };
    this.store.agentInterests.set(interest.id, interest);
    this.record(action === "JOIN" ? "agent_interest.joined" : "agent_interest.left", agent, mission.id, "MISSION_AGENT_INTEREST", interest.id, interest);
    return interest;
  }

  private interestedAgentCount(missionId: string): number {
    return [...this.store.agentInterests.values()].filter(
      (interest) => interest.missionId === missionId && interest.status === "INTERESTED",
    ).length;
  }

  grantDelegation(input: {
    missionId: string;
    grantedBy: Actor;
    agentId: string;
    agentDisplayName: string;
  }): AgentDelegation {
    const mission = this.mission(input.missionId);
    if (input.grantedBy.type !== "human" || mission.creator.id !== input.grantedBy.id) {
      throw new DomainError("Only the human mission owner can authorize an agent");
    }
    if (this.activeDelegation(input.missionId, input.agentId)) {
      throw new DomainError("This agent already has active authority for the mission");
    }
    const delegation: AgentDelegation = {
      id: randomUUID(),
      missionId: input.missionId,
      grantedBy: input.grantedBy,
      agent: {
        id: input.agentId,
        type: "agent",
        displayName: input.agentDisplayName,
      },
      status: "ACTIVE",
      createdAt: now(),
    };
    this.store.delegations.set(delegation.id, delegation);
    this.record("delegation.granted", input.grantedBy, mission.id, "DELEGATION", delegation.id, delegation);
    return delegation;
  }

  revokeDelegation(input: {
    missionId: string;
    delegationId: string;
    revokedBy: Actor;
  }): AgentDelegation {
    const mission = this.mission(input.missionId);
    if (input.revokedBy.type !== "human" || mission.creator.id !== input.revokedBy.id) {
      throw new DomainError("Only the human mission owner can revoke agent authority");
    }
    const delegation = this.store.delegations.get(input.delegationId);
    if (!delegation || delegation.missionId !== input.missionId) {
      throw new DomainError("Delegation not found for this mission");
    }
    if (delegation.status !== "ACTIVE") throw new DomainError("Delegation is not active");
    delegation.status = "REVOKED";
    delegation.revokedAt = now();
    this.record("delegation.revoked", input.revokedBy, mission.id, "DELEGATION", delegation.id, delegation);
    return delegation;
  }

  proposePlan(missionId: string, proposedBy: Actor, tasks: TaskDraft[]): PlanProposal {
    const mission = this.mission(missionId);
    if (mission.status === "ABANDONED") {
      throw new DomainError("Abandoned missions cannot accept plans");
    }
    const normalizedTasks = tasks.map((task) => ({
      ...task,
      tags: labels(task.tags),
      requiredCapabilities: labels(task.requiredCapabilities),
    }));
    this.validatePlan(normalizedTasks);

    // Route every legacy plan through a mission-level decision gate so the
    // single canonical planning model is "decision gate → proposals → votes → selection".
    const gate = this.openDecisionGate({
      missionId,
      actor: proposedBy,
      level: "MISSION",
      title: `Initial plan: ${mission.title}`,
      question: `Which plan should be used to start mission "${mission.title}"?`,
      risk: "LOW",
      proposalHours: 0,
      reviewHours: 0,
      ownerGraceHours: 168,
      minIndependentBallots: 1,
      autoSelect: true,
    });

    const proposal = this.createDecisionProposalInternal(gate, {
      proposedBy,
      title: "Initial plan",
      summary: "Plan submitted via the legacy plan-proposal path.",
      tasks: normalizedTasks,
    });

    const plan: PlanProposal = {
      id: randomUUID(),
      missionId,
      proposedBy,
      status: "PROPOSED",
      tasks: normalizedTasks,
      decisionGateId: gate.id,
      decisionProposalId: proposal.id,
      createdAt: now(),
    };
    this.store.plans.set(plan.id, plan);
    this.record("plan.proposed", proposedBy, missionId, "PLAN", plan.id, plan);

    if (proposedBy.type === "agent") {
      this.submitDecisionBallot({
        gateId: gate.id,
        voter: proposedBy,
        rankedProposalIds: [proposal.id],
        rationale: "Initial agent proposal submitted for consensus.",
        objections: [],
      });
      if (gate.status === "SELECTED") plan.status = "APPROVED";
    }

    // Advance immediately so a one-agent mission can continue without a timer.
    this.advanceDecisionGates(now(), gate.id);

    return plan;
  }

  approvePlan(missionId: string, planId: string, approvedBy: Actor): Task[] {
    const mission = this.mission(missionId);
    const plan = this.plan(planId);
    if (plan.missionId !== missionId) throw new DomainError("Plan belongs to another mission");
    this.assertMissionController(mission, approvedBy);
    if (mission.status !== "AWAITING_APPROVAL") {
      throw new DomainError("Mission is not awaiting plan approval");
    }
    if (!plan.decisionGateId || !plan.decisionProposalId) {
      throw new DomainError("Plan is not linked to a decision gate");
    }

    const gate = this.decisionGate(plan.decisionGateId);
    const proposal = this.decisionProposal(plan.decisionProposalId);
    this.advanceDecisionGates(now(), gate.id);
    if (gate.status !== "AWAITING_HUMAN" && gate.status !== "PAUSED") {
      throw new DomainError("Plan is no longer awaiting a decision");
    }

    // Use the internal selector so legacy plan approval by an authorized agent
    // still works; the public decision-gate path keeps owner/fallback authority.
    this.selectDecisionProposalInternal(
      gate,
      proposal,
      approvedBy,
      "Approved by mission controller via legacy plan approval path",
    );

    plan.status = "APPROVED";
    this.record("plan.approved", approvedBy, missionId, "PLAN", plan.id, { planId });

    return [...this.store.tasks.values()].filter(
      (task) => task.missionId === missionId && task.decisionGateId === gate.id,
    );
  }

  rejectPlan(input: {
    missionId: string;
    planId: string;
    rejectedBy: Actor;
    reason: string;
  }): PlanProposal {
    const mission = this.mission(input.missionId);
    this.assertHumanMissionOwner(mission, input.rejectedBy);
    const plan = this.plan(input.planId);
    if (plan.missionId !== mission.id) throw new DomainError("Plan belongs to another mission");
    if (plan.status !== "PROPOSED" || mission.status !== "AWAITING_APPROVAL") {
      throw new DomainError("Plan is no longer awaiting a decision");
    }
    if (!plan.decisionGateId) {
      throw new DomainError("Plan is not linked to a decision gate");
    }

    const gate = this.decisionGate(plan.decisionGateId);
    this.advanceDecisionGates(now(), gate.id);
    if (!["PROPOSING", "REVIEWING", "AWAITING_HUMAN"].includes(gate.status)) {
      throw new DomainError("Plan is no longer awaiting a decision");
    }

    this.pauseDecisionGate(gate, input.reason);

    plan.status = "REJECTED";
    this.record("plan.rejected", input.rejectedBy, mission.id, "PLAN", plan.id, { reason: input.reason });
    this.setMissionStatus(mission, "PLANNING", input.rejectedBy);
    return plan;
  }

  openDecisionGate(input: {
    missionId: string;
    actor: Actor;
    taskId?: string | undefined;
    parentGateId?: string | undefined;
    level: DecisionGate["level"];
    title: string;
    question: string;
    risk: DecisionGate["risk"];
    proposalHours?: number | undefined;
    reviewHours?: number | undefined;
    ownerGraceHours?: number | undefined;
    minIndependentBallots: number;
    autoSelect: boolean;
    fallbackHumanId?: string | undefined;
    fallbackHumanDisplayName?: string | undefined;
  }): DecisionGate {
    const mission = this.mission(input.missionId);
    this.assertAgentTextLength(input.actor, {
      title: input.title,
      question: input.question,
    }, { title: 120, question: 500 });
    if ((input.fallbackHumanId || input.fallbackHumanDisplayName)
      && !(input.actor.type === "human" && mission.creator.type === "human" && mission.creator.id === input.actor.id)) {
      throw new DomainError("Only the human mission owner can pre-authorize a fallback steward");
    }
    if (["ABANDONED", "COMPLETED"].includes(mission.status)) throw new DomainError("Reopen the mission before starting another planning thread");
    if (input.taskId) {
      const task = this.task(input.taskId);
      if (task.missionId !== mission.id) throw new DomainError("Task belongs to another mission");
    }
    if (input.parentGateId) {
      const parent = this.decisionGate(input.parentGateId);
      if (parent.missionId !== mission.id) throw new DomainError("Parent decision gate belongs to another mission");
      if (parent.status !== "SELECTED") throw new DomainError("Parent decision gate must be selected first");
    }
    // Mission-level gates represent competing overall approaches and may overlap.
    // For other levels, only an active proposal/review window at the same scope
    // blocks a new gate; an owner-decision phase or paused gate does not.
    const overlapping = input.level !== "MISSION"
      && [...this.store.decisionGates.values()].some((gate) =>
        gate.missionId === mission.id
        && gate.level === input.level
        && gate.taskId === input.taskId
        && ["PROPOSING", "REVIEWING"].includes(gate.status),
      );
    if (overlapping) throw new DomainError("This mission scope already has an active decision gate");

    const timestamp = now();
    // Risk-tiered fixed windows keep thread creators from manipulating deadlines.
    // Override with env vars for local testing (e.g., 0.001 hours = 3.6 seconds).
    const windows = decisionGateWindows(input.risk);
    const proposalClosesAt = new Date(Date.parse(timestamp) + windows.proposalHours * 3_600_000).toISOString();
    const reviewClosesAt = new Date(Date.parse(proposalClosesAt) + windows.reviewHours * 3_600_000).toISOString();
    const ownerDecisionClosesAt = new Date(
      Date.parse(reviewClosesAt) + windows.ownerGraceHours * 3_600_000,
    ).toISOString();
    if (input.actor.type === "agent") this.setAgentInterestInternal(mission, input.actor, "JOIN");
    const interestedAgentCount = this.interestedAgentCount(mission.id);
    const gate: DecisionGate = {
      id: randomUUID(),
      missionId: mission.id,
      ...(input.taskId ? { taskId: input.taskId } : {}),
      ...(input.parentGateId ? { parentGateId: input.parentGateId } : {}),
      level: input.level,
      title: input.title,
      question: input.question,
      risk: input.risk,
      status: "PROPOSING",
      decisionModel: "AGENT_QUORUM",
      createdBy: input.actor,
      proposalClosesAt,
      reviewClosesAt,
      ownerDecisionClosesAt,
      minIndependentBallots: input.minIndependentBallots,
      interestedAgentCount,
      requiredApprovals: agentApprovalTarget(interestedAgentCount),
      autoSelect: input.autoSelect,
      ...(input.fallbackHumanId && input.fallbackHumanDisplayName ? {
        fallbackHuman: {
          id: input.fallbackHumanId,
          type: "human" as const,
          displayName: input.fallbackHumanDisplayName,
        },
      } : {}),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.store.decisionGates.set(gate.id, gate);
    if (mission.status === "PROPOSED") this.setMissionStatus(mission, "PLANNING", input.actor);
    this.record("decision_gate.opened", input.actor, mission.id, "DECISION_GATE", gate.id, gate);
    return gate;
  }

  submitDecisionProposal(input: {
    gateId: string;
    proposedBy: Actor;
    title: string;
    summary: string;
    tasks: TaskDraft[];
    attachments?: Attachment[];
  }): DecisionProposal {
    if (input.proposedBy.type === "agent") {
      const mission = this.mission(this.decisionGate(input.gateId).missionId);
      this.setAgentInterestInternal(mission, input.proposedBy, "JOIN");
    }
    this.advanceDecisionGates(now(), input.gateId);
    const gate = this.decisionGate(input.gateId);
    if (!(["PROPOSING", "REVIEWING"] as DecisionGate["status"][]).includes(gate.status)) {
      throw new DomainError("This decision gate is no longer accepting proposals");
    }
    return this.createDecisionProposalInternal(gate, input);
  }

  private createDecisionProposalInternal(
    gate: DecisionGate,
    input: {
      proposedBy: Actor;
      title: string;
      summary: string;
      tasks: TaskDraft[];
      attachments?: Attachment[];
    },
  ): DecisionProposal {
    this.assertAgentTextLength(input.proposedBy, {
      title: input.title,
      summary: input.summary,
    }, { title: 120, summary: 1_000 });
    this.assertAgentListLength(input.proposedBy, "attachments", input.attachments, 5);
    const duplicate = [...this.store.decisionProposals.values()].some((proposal) =>
      proposal.gateId === gate.id && proposal.proposedBy.id === input.proposedBy.id && proposal.status === "ACTIVE",
    );
    if (duplicate) throw new DomainError("An actor can submit only one active proposal per decision gate");
    const tasks = input.tasks.map((task) => ({
      ...task,
      tags: labels(task.tags),
      requiredCapabilities: labels(task.requiredCapabilities),
    }));
    if (tasks.length > 0) this.validateDecisionTasks(gate.missionId, tasks);
    const proposal: DecisionProposal = {
      id: randomUUID(),
      gateId: gate.id,
      missionId: gate.missionId,
      proposedBy: input.proposedBy,
      title: input.title,
      summary: input.summary,
      tasks,
      attachments: input.attachments ?? [],
      status: "ACTIVE",
      createdAt: now(),
    };
    this.store.decisionProposals.set(proposal.id, proposal);
    gate.lastProposalAt = proposal.createdAt;
    gate.updatedAt = proposal.createdAt;
    if (gate.decisionModel === "AGENT_QUORUM" && !gate.quorumSnapshotAt) {
      const interestedAgentCount = this.interestedAgentCount(gate.missionId);
      gate.interestedAgentCount = interestedAgentCount;
      gate.requiredApprovals = agentApprovalTarget(interestedAgentCount);
      gate.quorumSnapshotAt = proposal.createdAt;
      gate.status = "REVIEWING";
      this.record("decision_gate.quorum_opened", input.proposedBy, gate.missionId, "DECISION_GATE", gate.id, {
        interestedAgentCount,
        requiredApprovals: gate.requiredApprovals,
      });
    }
    this.record("decision_proposal.submitted", input.proposedBy, gate.missionId, "DECISION_PROPOSAL", proposal.id, proposal);
    return proposal;
  }

  submitDecisionBallot(input: {
    gateId: string;
    voter: Actor;
    rankedProposalIds: string[];
    rationale: string;
    objections: DecisionBallot["objections"];
  }): DecisionBallot {
    this.assertAgentTextLength(input.voter, { rationale: input.rationale }, { rationale: 500 });
    this.advanceDecisionGates(now(), input.gateId);
    const gate = this.decisionGate(input.gateId);
    if (gate.status !== "REVIEWING") throw new DomainError("This decision gate is not accepting ballots");
    if (input.voter.type !== "agent") throw new DomainError("Only agents can participate in agent consensus");
    const interest = [...this.store.agentInterests.values()].find(
      (candidate) => candidate.missionId === gate.missionId
        && candidate.agent.id === input.voter.id
        && candidate.status === "INTERESTED",
    );
    if (!interest) throw new DomainError("Opt into this mission before responding to its proposals");
    const proposals = [...this.store.decisionProposals.values()].filter(
      (proposal) => proposal.gateId === gate.id && proposal.status === "ACTIVE",
    );
    // Agent consensus counts distinct participating agents. The first agent is
    // intentionally allowed to approve its own plan so a one-agent mission can start.
    const proposalIds = new Set(proposals.map((proposal) => proposal.id));
    if (input.rankedProposalIds.some((id) => !proposalIds.has(id))) {
      throw new DomainError("A ranked proposal is not active in this decision gate");
    }
    if (input.objections.some((objection) => !proposalIds.has(objection.proposalId))) {
      throw new DomainError("An objection references a proposal outside this decision gate");
    }
    const existing = [...this.store.decisionBallots.values()].find(
      (ballot) => ballot.gateId === gate.id && ballot.voter.id === input.voter.id,
    );
    const timestamp = now();
    if (existing) {
      existing.rankedProposalIds = input.rankedProposalIds;
      existing.rationale = input.rationale;
      existing.objections = input.objections;
      existing.updatedAt = timestamp;
      gate.lastBallotAt = timestamp;
      gate.updatedAt = timestamp;
      this.record("decision_ballot.updated", input.voter, gate.missionId, "DECISION_BALLOT", existing.id, existing);
      this.advanceDecisionGates(timestamp, gate.id);
      return existing;
    }
    const ballot: DecisionBallot = {
      id: randomUUID(),
      gateId: gate.id,
      missionId: gate.missionId,
      voter: input.voter,
      rankedProposalIds: input.rankedProposalIds,
      rationale: input.rationale,
      objections: input.objections,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.store.decisionBallots.set(ballot.id, ballot);
    gate.lastBallotAt = timestamp;
    gate.updatedAt = timestamp;
    this.record("decision_ballot.submitted", input.voter, gate.missionId, "DECISION_BALLOT", ballot.id, ballot);
    this.advanceDecisionGates(timestamp, gate.id);
    return ballot;
  }

  listDecisionGates(missionId: string): DecisionGateView[] {
    this.mission(missionId);
    return [...this.store.decisionGates.values()]
      .filter((gate) => gate.missionId === missionId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((gate) => this.decisionGateView(gate.id));
  }

  decisionGateView(gateId: string): DecisionGateView {
    const gate = this.decisionGate(gateId);
    return {
      gate,
      proposals: [...this.store.decisionProposals.values()].filter((proposal) => proposal.gateId === gate.id),
      ballots: [...this.store.decisionBallots.values()].filter((ballot) => ballot.gateId === gate.id),
      ranking: this.rankDecisionProposals(gate.id),
      interestedAgentCount: this.interestedAgentCount(gate.missionId),
      requiredApprovals: gate.requiredApprovals ?? agentApprovalTarget(gate.interestedAgentCount ?? 0),
    };
  }

  selectDecisionProposal(input: {
    gateId: string;
    proposalId: string;
    selectedBy: Actor;
    reason: string;
  }): DecisionGateView {
    this.advanceDecisionGates(now(), input.gateId);
    const gate = this.decisionGate(input.gateId);
    const mission = this.mission(gate.missionId);
    if (!["AWAITING_HUMAN", "PAUSED"].includes(gate.status)) {
      throw new DomainError("This decision gate is not awaiting selection");
    }
    const isOwner = input.selectedBy.type === "human"
      && mission.creator.type === "human"
      && mission.creator.id === input.selectedBy.id;
    const isActiveFallback = Boolean(
      gate.fallbackActivatedAt
      && gate.fallbackHuman?.id === input.selectedBy.id
      && input.selectedBy.type === "human",
    );
    if (!isOwner && !isActiveFallback) {
      throw new DomainError("Only the human mission owner or an activated fallback steward can select a proposal");
    }
    const proposal = this.decisionProposal(input.proposalId);
    if (proposal.gateId !== gate.id || proposal.status !== "ACTIVE") {
      throw new DomainError("Proposal is not active in this decision gate");
    }
    this.selectDecisionProposalInternal(gate, proposal, input.selectedBy, input.reason);
    return this.decisionGateView(gate.id);
  }

  private canAdvanceProposingEarly(gate: DecisionGate, cutoffMs: number): boolean {
    if (gate.status !== "PROPOSING" || gate.risk !== "LOW") return false;
    const proposals = [...this.store.decisionProposals.values()].filter(
      (proposal) => proposal.gateId === gate.id && proposal.status === "ACTIVE",
    );
    const minProposals = Number(process.env.SPARK_MIN_PROPOSALS_FOR_EARLY_REVIEW ?? 1);
    if (proposals.length < minProposals) return false;

    const quietMinutes = Number(process.env.SPARK_PROPOSAL_QUIET_MINUTES ?? 5);
    const quietMs = quietMinutes * 60_000;
    const lastProposalMs = gate.lastProposalAt ? Date.parse(gate.lastProposalAt) : cutoffMs;
    return cutoffMs - lastProposalMs >= quietMs;
  }

  private canAutoSelectEarly(gate: DecisionGate, cutoffMs: number): boolean {
    if (gate.risk !== "LOW" || !gate.autoSelect) return false;
    const ballots = [...this.store.decisionBallots.values()].filter((ballot) => ballot.gateId === gate.id);
    if (ballots.length < gate.minIndependentBallots) return false;

    const ranking = this.rankDecisionProposals(gate.id);
    const top = ranking[0];
    const runnerUp = ranking[1];
    if (!top) return false;
    if (top.blockingObjections > 0) return false;

    const topFirstChoices = top.agentFirstChoices + top.humanFirstChoices;
    const runnerFirstChoices = runnerUp ? runnerUp.agentFirstChoices + runnerUp.humanFirstChoices : 0;
    const clearLead = !runnerUp
      || (top.combinedPoints >= runnerUp.combinedPoints + 2 && topFirstChoices > runnerFirstChoices);
    if (!clearLead) return false;

    const quietMinutes = Number(process.env.SPARK_QUORUM_QUIET_MINUTES ?? 5);
    const quietMs = quietMinutes * 60_000;
    const lastBallotMs = gate.lastBallotAt ? Date.parse(gate.lastBallotAt) : cutoffMs;
    return cutoffMs - lastBallotMs >= quietMs;
  }

  advanceDecisionGates(asOf = now(), gateId?: string): DecisionGate[] {
    const cutoff = Date.parse(asOf);
    const changed: DecisionGate[] = [];
    const gates = [...this.store.decisionGates.values()].filter((gate) => !gateId || gate.id === gateId);
    for (const gate of gates) {
      if (gate.decisionModel === "AGENT_QUORUM") {
        if (["PROPOSING", "REVIEWING"].includes(gate.status)) {
          const selected = this.advanceAgentQuorum(gate, asOf);
          if (selected) changed.push(gate);
        }
        continue;
      }
      if (gate.status === "PROPOSING" && Date.parse(gate.proposalClosesAt) <= cutoff) {
        gate.status = "REVIEWING";
        gate.updatedAt = asOf;
        changed.push(gate);
        this.record("decision_gate.review_opened", systemActor, gate.missionId, "DECISION_GATE", gate.id, gate);
      }
      // Early advance to reviewing if enough plans are in and proposing has gone quiet.
      if (
        gate.status === "PROPOSING"
        && Date.parse(gate.proposalClosesAt) > cutoff
        && this.canAdvanceProposingEarly(gate, cutoff)
      ) {
        gate.status = "REVIEWING";
        gate.updatedAt = asOf;
        changed.push(gate);
        this.record("decision_gate.review_opened_early", systemActor, gate.missionId, "DECISION_GATE", gate.id, gate);
      }
      // Lazy-consensus early stop: close a reviewing LOW-risk gate before its deadline
      // if a clear leader has quorum support, no blocks, and voting has been quiet.
      if (
        gate.status === "REVIEWING"
        && Date.parse(gate.reviewClosesAt) > cutoff
        && this.canAutoSelectEarly(gate, cutoff)
      ) {
        const ranking = this.rankDecisionProposals(gate.id);
        const top = ranking[0];
        if (top) {
          const ballots = [...this.store.decisionBallots.values()].filter((ballot) => ballot.gateId === gate.id);
          this.selectDecisionProposalInternal(
            gate,
            top.proposal,
            systemActor,
            `Auto-selected early after ${ballots.length} independent ballots with a clear lead, no objections, and a quiet quorum period`,
            asOf,
          );
          if (!changed.includes(gate)) changed.push(gate);
        }
      }
      if (gate.status === "REVIEWING" && Date.parse(gate.reviewClosesAt) <= cutoff) {
        const proposals = [...this.store.decisionProposals.values()].filter(
          (proposal) => proposal.gateId === gate.id && proposal.status === "ACTIVE",
        );
        const ballots = [...this.store.decisionBallots.values()].filter((ballot) => ballot.gateId === gate.id);
        const ranking = this.rankDecisionProposals(gate.id);
        const top = ranking[0];
        const runnerUp = ranking[1];
        const topFirstChoices = top ? top.agentFirstChoices + top.humanFirstChoices : 0;
        const runnerFirstChoices = runnerUp ? runnerUp.agentFirstChoices + runnerUp.humanFirstChoices : 0;
        const clearLead = top !== undefined
          && (!runnerUp || (top.combinedPoints >= runnerUp.combinedPoints + 2 && topFirstChoices > runnerFirstChoices));
        if (proposals.length === 0 || !top) {
          gate.status = "PAUSED";
          gate.selectionReason = "No proposals were submitted before the deadline";
          gate.updatedAt = asOf;
          this.record("decision_gate.paused", systemActor, gate.missionId, "DECISION_GATE", gate.id, {
            reason: gate.selectionReason,
          });
        } else if (
          gate.risk === "LOW"
          && gate.autoSelect
          && ballots.length >= gate.minIndependentBallots
          && clearLead
          && top.blockingObjections === 0
        ) {
          this.selectDecisionProposalInternal(
            gate,
            top.proposal,
            systemActor,
            `Auto-selected after ${ballots.length} independent ballots with a clear lead and no objections`,
            asOf,
          );
        } else {
          gate.status = "AWAITING_HUMAN";
          gate.updatedAt = asOf;
          this.createDecisionReminder(gate);
          const mission = this.mission(gate.missionId);
          if (mission.status === "PLANNING") this.setMissionStatus(mission, "AWAITING_APPROVAL", systemActor);
          this.record("decision_gate.owner_selection_requested", systemActor, gate.missionId, "DECISION_GATE", gate.id, {
            ballotCount: ballots.length,
            reason: gate.risk === "HIGH" ? "high_risk" : "no_safe_consensus",
          });
        }
        if (!changed.includes(gate)) changed.push(gate);
      }
      if (gate.status === "AWAITING_HUMAN" && Date.parse(gate.ownerDecisionClosesAt) <= cutoff) {
        if (gate.fallbackHuman && !gate.fallbackActivatedAt) {
          gate.fallbackActivatedAt = asOf;
          gate.updatedAt = asOf;
          this.createFallbackDecisionReminder(gate);
          this.record("decision_gate.fallback_activated", systemActor, gate.missionId, "DECISION_GATE", gate.id, {
            fallbackHuman: gate.fallbackHuman,
          });
        } else if (!gate.fallbackHuman) {
          gate.status = "PAUSED";
          gate.selectionReason = "Owner decision deadline passed without a pre-authorized fallback steward";
          gate.updatedAt = asOf;
          this.record("decision_gate.paused", systemActor, gate.missionId, "DECISION_GATE", gate.id, {
            reason: gate.selectionReason,
          });
        }
        if (!changed.includes(gate)) changed.push(gate);
      }
    }
    return changed;
  }

  private advanceAgentQuorum(gate: DecisionGate, timestamp: string): boolean {
    const proposals = [...this.store.decisionProposals.values()].filter(
      (proposal) => proposal.gateId === gate.id && proposal.status === "ACTIVE",
    );
    if (!proposals.length) return false;
    const requiredApprovals = gate.requiredApprovals ?? agentApprovalTarget(gate.interestedAgentCount ?? 0);
    const ballots = [...this.store.decisionBallots.values()].filter(
      (ballot) => ballot.gateId === gate.id && ballot.voter.type === "agent",
    );
    const support = new Map<string, number>();
    for (const ballot of ballots) {
      const firstChoice = ballot.rankedProposalIds[0];
      if (firstChoice) support.set(firstChoice, (support.get(firstChoice) ?? 0) + 1);
    }
    const winner = proposals
      .filter((proposal) => (support.get(proposal.id) ?? 0) >= requiredApprovals)
      .sort((left, right) => {
        const difference = (support.get(right.id) ?? 0) - (support.get(left.id) ?? 0);
        return difference || left.createdAt.localeCompare(right.createdAt);
      })[0];
    if (!winner) return false;
    this.selectDecisionProposalInternal(
      gate,
      winner,
      systemActor,
      `Selected after ${support.get(winner.id) ?? 0} of ${requiredApprovals} agent approvals`,
      timestamp,
    );
    return true;
  }

  claimTask(taskId: string, agent: Actor): Claim {
    if (agent.type !== "agent") throw new DomainError("Only agents can claim tasks");
    this.expireClaims(now(), taskId);
    const task = this.task(taskId);
    const activeClaims = [...this.store.claims.values()].filter(
      (claim) => claim.taskId === taskId && claim.status === "ACTIVE",
    );
    const claimable = task.status === "OPEN" || (task.mode === "COMPETITIVE" && task.status === "CLAIMED");
    if (!claimable) throw new DomainError(`Task ${task.id} is not claimable`);
    if (task.mode === "EXCLUSIVE" && activeClaims.length > 0) {
      throw new DomainError("Exclusive task already has an active claim");
    }
    if (activeClaims.some((claim) => claim.agent.id === agent.id)) {
      throw new DomainError("Agent already holds an active claim for this task");
    }

    const timestamp = now();
    const claim: Claim = {
      id: randomUUID(),
      taskId,
      agent,
      status: "ACTIVE",
      claimedAt: timestamp,
      lastHeartbeatAt: timestamp,
      expiresAt: new Date(Date.parse(timestamp) + this.claimTtlMs).toISOString(),
    };
    this.store.claims.set(claim.id, claim);
    if (task.status === "OPEN") this.setTaskStatus(task, "CLAIMED", agent);
    this.record("claim.created", agent, task.missionId, "CLAIM", claim.id, claim);
    return claim;
  }

  heartbeatClaim(claimId: string, agent: Actor): Claim {
    const claim = this.claim(claimId);
    if (claim.agent.id !== agent.id) throw new DomainError("Claim belongs to another agent");
    if (claim.status !== "ACTIVE") throw new DomainError("Claim is not active");
    const timestamp = now();
    if (Date.parse(claim.expiresAt) <= Date.parse(timestamp)) {
      this.expireClaims(timestamp, claim.taskId);
      return claim;
    }
    claim.lastHeartbeatAt = timestamp;
    claim.expiresAt = new Date(Date.parse(timestamp) + this.claimTtlMs).toISOString();
    const task = this.task(claim.taskId);
    this.record("claim.heartbeat", agent, task.missionId, "CLAIM", claim.id, {
      lastHeartbeatAt: claim.lastHeartbeatAt,
      expiresAt: claim.expiresAt,
    });
    return claim;
  }

  expireClaims(asOf = now(), taskId?: string): Claim[] {
    const cutoff = Date.parse(asOf);
    const expired = [...this.store.claims.values()].filter(
      (claim) =>
        claim.status === "ACTIVE"
        && (!taskId || claim.taskId === taskId)
        && Date.parse(claim.expiresAt) <= cutoff,
    );
    const affectedTasks = new Set<string>();
    for (const claim of expired) {
      claim.status = "EXPIRED";
      affectedTasks.add(claim.taskId);
      const task = this.task(claim.taskId);
      this.record("claim.expired", systemActor, task.missionId, "CLAIM", claim.id, {
        expiresAt: claim.expiresAt,
      });
    }
    for (const affectedTaskId of affectedTasks) {
      const task = this.task(affectedTaskId);
      const stillClaimed = [...this.store.claims.values()].some(
        (claim) => claim.taskId === affectedTaskId && claim.status === "ACTIVE",
      );
      if (!stillClaimed && task.status === "CLAIMED") this.setTaskStatus(task, "OPEN", systemActor);
    }
    return expired;
  }

  submitContribution(input: {
    claimId: string;
    author: Actor;
    summary: string;
    evidence: Evidence[];
  }): Contribution {
    const claim = this.claim(input.claimId);
    if (claim.status !== "ACTIVE") throw new DomainError("Claim is not active");
    if (claim.agent.id !== input.author.id) throw new DomainError("Only the claiming agent can submit");
    const task = this.task(claim.taskId);
    const timestamp = now();
    const contribution: Contribution = {
      id: randomUUID(),
      taskId: task.id,
      claimId: claim.id,
      author: input.author,
      summary: input.summary,
      evidence: input.evidence,
      status: "SUBMITTED",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    claim.status = "RELEASED";
    this.store.contributions.set(contribution.id, contribution);
    if (task.status === "CLAIMED") this.setTaskStatus(task, "SUBMITTED", input.author);
    this.record("contribution.submitted", input.author, task.missionId, "CONTRIBUTION", contribution.id, contribution);
    this.record("claim.released", input.author, task.missionId, "CLAIM", claim.id, { reason: "submitted" });
    return contribution;
  }

  reviewContribution(input: {
    contributionId: string;
    reviewer: Actor;
    verdict: "PASSED" | "FAILED";
    findings: string[];
    evidence: Evidence[];
  }): Review {
    const contribution = this.contribution(input.contributionId);
    const task = this.task(contribution.taskId);
    const selfReview = contribution.author.id === input.reviewer.id;
    if (contribution.status !== "SUBMITTED" && contribution.status !== "REVIEWING") {
      throw new DomainError("Contribution is no longer accepting reviews");
    }
    const alreadyReviewed = [...this.store.reviews.values()].some(
      (review) => review.contributionId === contribution.id && review.reviewer.id === input.reviewer.id,
    );
    if (alreadyReviewed) throw new DomainError("Reviewer has already reviewed this contribution");
    const review: Review = {
      id: randomUUID(),
      contributionId: contribution.id,
      reviewer: input.reviewer,
      status: input.verdict,
      findings: input.findings,
      evidence: input.evidence,
      selfReview,
      createdAt: now(),
    };
    this.store.reviews.set(review.id, review);
    this.record("review.submitted", input.reviewer, task.missionId, "REVIEW", review.id, review);

    if (selfReview) return review;

    if (contribution.status === "SUBMITTED") {
      transitions.contribution(contribution.status, "REVIEWING");
      contribution.status = "REVIEWING";
      contribution.updatedAt = now();
    }
    if (task.status === "SUBMITTED") this.setTaskStatus(task, "VERIFYING", input.reviewer);

    if (input.verdict === "PASSED") {
      transitions.contribution(contribution.status, "ACCEPTED");
      contribution.status = "ACCEPTED";
      contribution.updatedAt = now();
      this.setTaskStatus(task, "VERIFIED", input.reviewer);
      this.openUnblockedTasks(task.missionId, input.reviewer);
      this.checkMilestoneCompletion(task.missionId, input.reviewer);
    } else {
      transitions.contribution(contribution.status, "CHANGES_REQUESTED");
      contribution.status = "CHANGES_REQUESTED";
      contribution.updatedAt = now();
      this.setTaskStatus(task, "OPEN", input.reviewer);
    }
    return review;
  }

  createHumanRequest(input: {
    missionId: string;
    taskId?: string | undefined;
    requestedBy: Actor;
    kind?: "DECISION" | "PERMISSION" | "INFORMATION" | undefined;
    blocking?: boolean | undefined;
    question: string;
    reason: string;
    targetHumanId?: string | undefined;
    targetHumanDisplayName?: string | undefined;
    expiresInHours?: number | undefined;
  }): HumanRequest {
    if (input.requestedBy.type !== "agent") throw new DomainError("Only agents can create human requests");
    const mission = this.mission(input.missionId);
    const task = input.taskId ? this.task(input.taskId) : undefined;
    if (task && task.missionId !== mission.id) throw new DomainError("Task belongs to another mission");
    const blocking = input.blocking ?? false;
    if (blocking && !task) throw new DomainError("A blocking human request must identify its task");
    if (blocking && task && task.status !== "OPEN" && task.status !== "CLAIMED") {
      throw new DomainError("Only open or claimed work can wait on a human decision");
    }
    const targetHuman = this.resolveHumanTarget(mission, input);
    const timestamp = now();
    const expiresInHours = input.expiresInHours ?? 72;
    const request: HumanRequest = {
      id: randomUUID(),
      missionId: input.missionId,
      ...(input.taskId ? { taskId: input.taskId } : {}),
      requestedBy: input.requestedBy,
      targetHuman,
      kind: input.kind ?? "DECISION",
      blocking,
      question: input.question,
      reason: input.reason,
      status: "OPEN",
      createdAt: timestamp,
      expiresAt: new Date(Date.parse(timestamp) + expiresInHours * 60 * 60 * 1000).toISOString(),
    };
    this.store.humanRequests.set(request.id, request);
    if (blocking && task) {
      for (const claim of this.store.claims.values()) {
        if (claim.taskId === task.id && claim.status === "ACTIVE") {
          claim.status = "RELEASED";
          this.record("claim.released", input.requestedBy, mission.id, "CLAIM", claim.id, {
            reason: "waiting_for_human",
            humanRequestId: request.id,
          });
        }
      }
      this.setTaskStatus(task, "BLOCKED", input.requestedBy);
    }
    this.record("human_request.created", input.requestedBy, input.missionId, "HUMAN_REQUEST", request.id, request);
    return request;
  }

  registerRepository(input: {
    missionId: string;
    actor: Actor;
    kind: "EXISTING" | "NEW_PROJECT";
    sponsorType: "HUMAN" | "ORGANIZATION";
    sponsorDisplayName: string;
    owner: string;
    repository: string;
    githubRepositoryId: number;
    repositoryUrl: string;
    defaultBranch: string;
    proofPath: ".spark/mission.json";
  }): RepositoryBinding {
    const mission = this.mission(input.missionId);
    this.assertMissionController(mission, input.actor);
    if ([...this.store.repositoryBindings.values()].some((binding) =>
      binding.missionId === mission.id && binding.githubRepositoryId === input.githubRepositoryId)) {
      throw new DomainError("This repository is already linked to the mission");
    }
    const timestamp = now();
    const binding: RepositoryBinding = {
      id: randomUUID(),
      missionId: input.missionId,
      kind: input.kind,
      status: "VERIFIED",
      registeredBy: input.actor,
      sponsor: {
        type: input.sponsorType,
        githubOwner: input.owner,
        displayName: input.sponsorDisplayName,
      },
      owner: input.owner,
      repository: input.repository,
      githubRepositoryId: input.githubRepositoryId,
      repositoryUrl: input.repositoryUrl,
      defaultBranch: input.defaultBranch,
      proofPath: input.proofPath,
      verifiedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.store.repositoryBindings.set(binding.id, binding);
    mission.repositoryUrl ??= binding.repositoryUrl;
    mission.updatedAt = timestamp;
    this.record("repository.registered", input.actor, mission.id, "REPOSITORY", binding.id, binding);
    return binding;
  }

  proposePublication(input: {
    missionId: string;
    proposedBy: Actor;
    title: string;
    version: string;
    summary: string;
    artifactUri: string;
    evidence: Evidence[];
    tags?: string[] | undefined;
    capabilities?: string[] | undefined;
    targetHumanId?: string | undefined;
    targetHumanDisplayName?: string | undefined;
  }): Publication {
    if (input.proposedBy.type !== "agent") throw new DomainError("Only agents can propose publication");
    const mission = this.mission(input.missionId);
    this.assertMissionController(mission, input.proposedBy);
    if (!["ACTIVE", "VERIFYING", "COMPLETED"].includes(mission.status)
      || ![...this.store.tasks.values()].some((task) => task.missionId === mission.id && task.status === "VERIFIED")) {
      throw new DomainError("Publication requires verified work in an active or completed mission");
    }
    const repository = [...this.store.repositoryBindings.values()].find(
      (binding) => binding.missionId === mission.id && binding.status === "VERIFIED",
    );
    if (!repository) throw new DomainError("Mission requires a verified repository before publication");
    const duplicate = [...this.store.publications.values()].some(
      (publication) => publication.missionId === mission.id && publication.version === input.version,
    );
    if (duplicate) throw new DomainError("This mission version already has a publication record");
    const publication: Publication = {
      id: randomUUID(),
      missionId: mission.id,
      proposedBy: input.proposedBy,
      targetHuman: this.resolveHumanTarget(mission, {
        requestedBy: input.proposedBy,
        targetHumanId: input.targetHumanId,
        targetHumanDisplayName: input.targetHumanDisplayName,
      }),
      title: input.title,
      version: input.version,
      summary: input.summary,
      artifactUri: input.artifactUri,
      evidence: input.evidence,
      tags: labels(input.tags),
      capabilities: labels(input.capabilities),
      status: "PROPOSED",
      createdAt: now(),
    };
    this.store.publications.set(publication.id, publication);
    this.record(
      "publication.proposed",
      input.proposedBy,
      mission.id,
      "PUBLICATION",
      publication.id,
      publication,
    );
    return publication;
  }

  decidePublication(input: {
    publicationId: string;
    decidedBy: Actor;
    verdict: "PUBLISHED" | "REJECTED";
    reason: string;
  }): Publication {
    if (input.decidedBy.type !== "human") throw new DomainError("Only a human can decide publication");
    const publication = this.publication(input.publicationId);
    if (publication.status !== "PROPOSED") throw new DomainError("Publication proposal is no longer awaiting a decision");
    if (publication.targetHuman.id !== input.decidedBy.id) {
      throw new DomainError("This publication proposal is addressed to another person");
    }
    publication.status = input.verdict;
    publication.decisionReason = input.reason;
    publication.decidedBy = input.decidedBy;
    publication.decidedAt = now();
    this.record(
      input.verdict === "PUBLISHED" ? "publication.published" : "publication.rejected",
      input.decidedBy,
      publication.missionId,
      "PUBLICATION",
      publication.id,
      { verdict: input.verdict, reason: input.reason },
    );
    return publication;
  }

  withdrawPublication(input: {
    publicationId: string;
    withdrawnBy: Actor;
    reason: string;
  }): Publication {
    if (input.withdrawnBy.type !== "human") throw new DomainError("Only a human can withdraw publication");
    const publication = this.publication(input.publicationId);
    if (publication.status !== "PUBLISHED") throw new DomainError("Only a published record can be withdrawn");
    if (publication.targetHuman.id !== input.withdrawnBy.id) {
      throw new DomainError("Only the publication authority can withdraw this record");
    }
    publication.status = "WITHDRAWN";
    publication.withdrawalReason = input.reason;
    publication.withdrawnAt = now();
    this.record(
      "publication.withdrawn",
      input.withdrawnBy,
      publication.missionId,
      "PUBLICATION",
      publication.id,
      { reason: input.reason },
    );
    return publication;
  }

  answerHumanRequest(requestId: string, answeredBy: Actor, answer: string): HumanRequest {
    if (answeredBy.type !== "human") throw new DomainError("Only a human can answer a human request");
    const request = this.humanRequest(requestId);
    this.expireHumanRequests(now(), request.id);
    if (request.status === "EXPIRED") throw new DomainError("Human request has expired");
    if (request.targetHuman.id !== answeredBy.id) {
      throw new DomainError("This human request is addressed to another person");
    }
    transitions.humanRequest(request.status, "ANSWERED");
    request.status = "ANSWERED";
    request.answer = answer;
    request.answeredBy = answeredBy;
    request.answeredAt = now();
    this.record("human_request.answered", answeredBy, request.missionId, "HUMAN_REQUEST", request.id, {
      answer,
    });
    if (request.blocking && request.taskId) {
      const task = this.task(request.taskId);
      const anotherGateIsOpen = [...this.store.humanRequests.values()].some(
        (candidate) =>
          candidate.id !== request.id
          && candidate.taskId === request.taskId
          && candidate.blocking
          && candidate.status === "OPEN",
      );
      const dependenciesReady = (task.dependsOn ?? []).every((id) => this.task(id).status === "VERIFIED");
      if (!anotherGateIsOpen && dependenciesReady && task.status === "BLOCKED") {
        this.setTaskStatus(task, "OPEN", answeredBy);
      }
    }
    return request;
  }

  missionProgress(missionId: string) {
    return buildMissionProgress(this.store, this.mission(missionId));
  }

  completeMission(input: { missionId: string; actor: Actor; reason: string }): Mission {
    const mission = this.mission(input.missionId);
    this.assertMissionController(mission, input.actor);
    if (!input.reason.trim()) throw new DomainError("Explain how the mission goal was reached");
    if (!["ACTIVE", "VERIFYING"].includes(mission.status) || !this.missionProgress(mission.id).canComplete) {
      throw new DomainError("Resolve active tasks, planning threads and blocking human requests before completing the goal");
    }
    if (mission.status === "ACTIVE") this.setMissionStatus(mission, "VERIFYING", input.actor);
    mission.completion = { reason: input.reason.trim(), actor: input.actor, completedAt: now() };
    this.setMissionStatus(mission, "COMPLETED", input.actor);
    this.record("mission.goal_completed", input.actor, mission.id, "MISSION", mission.id, mission.completion);
    return mission;
  }

  reopenMission(input: { missionId: string; actor: Actor; reason: string }): Mission {
    const mission = this.mission(input.missionId);
    this.assertMissionController(mission, input.actor);
    if (mission.status !== "COMPLETED") throw new DomainError("Only completed missions can be reopened");
    if (!input.reason.trim()) throw new DomainError("Explain why the mission is continuing");
    mission.completion = undefined;
    this.setMissionStatus(mission, "ACTIVE", input.actor);
    this.record("mission.reopened", input.actor, mission.id, "MISSION", mission.id, { reason: input.reason.trim() });
    return mission;
  }

  abandonMission(input: { missionId: string; abandonedBy: Actor; reason: string }): Mission {
    const mission = this.mission(input.missionId);
    this.assertHumanMissionOwner(mission, input.abandonedBy);
    if (mission.status === "COMPLETED" || mission.status === "ABANDONED") {
      throw new DomainError("Completed or abandoned missions cannot be abandoned");
    }
    const tasks = [...this.store.tasks.values()].filter((task) => task.missionId === mission.id);
    for (const task of tasks) {
      this.releaseTaskClaims(task, input.abandonedBy, "mission_abandoned");
      this.expireTaskHumanRequests(task.id, input.abandonedBy, "mission_abandoned");
      if (task.status !== "VERIFIED" && task.status !== "CANCELLED") {
        this.setTaskStatus(task, "CANCELLED", input.abandonedBy);
      }
    }
    this.record("mission.abandoned_by_owner", input.abandonedBy, mission.id, "MISSION", mission.id, {
      reason: input.reason,
    });
    this.setMissionStatus(mission, "ABANDONED", input.abandonedBy);
    return mission;
  }

  cancelTask(input: { taskId: string; cancelledBy: Actor; reason: string }): Task[] {
    const task = this.task(input.taskId);
    const mission = this.mission(task.missionId);
    this.assertHumanMissionOwner(mission, input.cancelledBy);
    if (task.status === "VERIFIED" || task.status === "CANCELLED") {
      throw new DomainError("Verified or cancelled work cannot be cancelled directly");
    }
    const affected = this.taskAndDependents(task.id);
    if (affected.some((candidate) => candidate.status === "VERIFIED")) {
      throw new DomainError("A verified dependent must be reopened before cancelling its dependency");
    }
    for (const candidate of affected) {
      if (candidate.status === "CANCELLED") continue;
      this.releaseTaskClaims(candidate, input.cancelledBy, "task_cancelled");
      this.expireTaskHumanRequests(candidate.id, input.cancelledBy, "task_cancelled");
      this.setTaskStatus(candidate, "CANCELLED", input.cancelledBy);
      this.record("task.cancelled_by_owner", input.cancelledBy, mission.id, "TASK", candidate.id, {
        reason: input.reason,
        sourceTaskId: task.id,
      });
    }
    this.checkMilestoneCompletion(mission.id, input.cancelledBy);
    return affected;
  }

  reopenTask(input: { taskId: string; reopenedBy: Actor; reason: string }): Task[] {
    const task = this.task(input.taskId);
    const mission = this.mission(task.missionId);
    this.assertHumanMissionOwner(mission, input.reopenedBy);
    if (task.status !== "VERIFIED") throw new DomainError("Only verified work can be reopened");
    const activePublication = [...this.store.publications.values()].find(
      (publication) =>
        publication.missionId === mission.id
        && (publication.status === "PROPOSED" || publication.status === "PUBLISHED"),
    );
    if (activePublication) {
      throw new DomainError("Reject or withdraw the active publication before reopening verified work");
    }
    if (mission.status === "COMPLETED" || mission.status === "VERIFYING") {
      mission.completion = undefined;
      this.setMissionStatus(mission, "ACTIVE", input.reopenedBy);
    }
    const affected = this.taskAndDependents(task.id).filter((candidate) => candidate.status !== "CANCELLED");
    for (const candidate of affected) {
      this.releaseTaskClaims(candidate, input.reopenedBy, "owner_reopened_work");
      for (const contribution of this.store.contributions.values()) {
        if (contribution.taskId === candidate.id && contribution.status === "ACCEPTED") {
          transitions.contribution(contribution.status, "CHANGES_REQUESTED");
          contribution.status = "CHANGES_REQUESTED";
          contribution.updatedAt = now();
          this.record(
            "contribution.reopened_by_owner",
            input.reopenedBy,
            mission.id,
            "CONTRIBUTION",
            contribution.id,
            { reason: input.reason },
          );
        }
      }
      const nextStatus = candidate.id === task.id ? "OPEN" : "BLOCKED";
      if (candidate.status !== nextStatus) this.setTaskStatus(candidate, nextStatus, input.reopenedBy);
      this.record("task.reopened_by_owner", input.reopenedBy, mission.id, "TASK", candidate.id, {
        reason: input.reason,
        sourceTaskId: task.id,
      });
    }
    const affectedGateIds = new Set(affected.map((candidate) => candidate.decisionGateId).filter(Boolean) as string[]);
    for (const gateId of affectedGateIds) {
      this.resetNextForkSuggestionForGate(gateId, "A task in the milestone was reopened");
    }
    return affected;
  }

  expireHumanRequests(asOf = now(), requestId?: string): HumanRequest[] {
    const cutoff = Date.parse(asOf);
    const expired = [...this.store.humanRequests.values()].filter(
      (request) =>
        request.status === "OPEN"
        && (!requestId || request.id === requestId)
        && Date.parse(request.expiresAt) <= cutoff,
    );
    for (const request of expired) {
      transitions.humanRequest(request.status, "EXPIRED");
      request.status = "EXPIRED";
      request.expiredAt = asOf;
      this.record("human_request.expired", systemActor, request.missionId, "HUMAN_REQUEST", request.id, {
        expiresAt: request.expiresAt,
      });
    }
    return expired;
  }

  postBoardEntry(input: {
    missionId: string;
    taskId?: string | undefined;
    type: BoardEntryType;
    author: Actor;
    summary: string;
    details?: string | undefined;
    evidence?: Evidence[] | undefined;
    attachments?: Attachment[] | undefined;
    references?: BoardReference[] | undefined;
    tags?: string[] | undefined;
    confidence?: BoardEntry["confidence"] | undefined;
    requestedAction?: string | undefined;
    idempotencyKey?: string | undefined;
  }): BoardEntry {
    this.assertAgentTextLength(input.author, {
      summary: input.summary,
      details: input.details,
      requestedAction: input.requestedAction,
    }, { summary: 200, details: 1_000, requestedAction: 200 });
    this.assertAgentListLength(input.author, "tags", input.tags, 5);
    this.assertAgentListLength(input.author, "attachments", input.attachments, 5);
    for (const evidence of input.evidence ?? []) {
      this.assertAgentTextLength(input.author, { evidenceSummary: evidence.summary }, { evidenceSummary: 200 });
    }
    const mission = this.mission(input.missionId);
    if (mission.status === "ABANDONED") throw new DomainError("Abandoned missions do not accept board entries");
    if (input.type === "DECISION") this.assertHumanMissionOwner(mission, input.author);

    if (input.taskId) {
      const task = this.task(input.taskId);
      if (task.missionId !== mission.id) throw new DomainError("Task belongs to another mission");
    }
    if (input.idempotencyKey) {
      const existing = [...this.store.boardEntries.values()].find(
        (entry) =>
          entry.missionId === mission.id
          && entry.author.id === input.author.id
          && entry.idempotencyKey === input.idempotencyKey,
      );
      if (existing) return existing;
    }

    const references = input.references ?? [];
    const referenceKeys = new Set<string>();
    for (const reference of references) {
      const key = `${reference.relation}:${reference.entryId}`;
      if (referenceKeys.has(key)) throw new DomainError("Duplicate board reference");
      referenceKeys.add(key);
      const target = this.boardEntry(reference.entryId);
      if (target.missionId !== mission.id) throw new DomainError("Board references cannot cross missions");
      if (reference.relation === "REPLIES_TO") {
        const seen = new Set<string>([target.id]);
        let cursor = target;
        while (true) {
          const parent = cursor.references.find((candidate) => candidate.relation === "REPLIES_TO");
          if (!parent) break;
          if (parent.entryId === target.id || seen.has(parent.entryId)) throw new DomainError("Board reply would create a cycle");
          seen.add(parent.entryId);
          cursor = this.boardEntry(parent.entryId);
        }
      }
      if (input.taskId && target.taskId && target.taskId !== input.taskId) {
        throw new DomainError("Task-scoped board entries cannot close or replace entries from another task");
      }
      if (["RESOLVES", "SUPERSEDES", "DUPLICATES"].includes(reference.relation)) {
        const isOwner = input.author.type === "human" && mission.creator.id === input.author.id;
        if (!isOwner && target.author.id !== input.author.id) {
          throw new DomainError(`${reference.relation} requires the original author or human mission owner`);
        }
      }
    }

    const entry: BoardEntry = {
      id: randomUUID(),
      missionId: mission.id,
      ...(input.taskId ? { taskId: input.taskId } : {}),
      type: input.type,
      author: input.author,
      summary: input.summary,
      ...(input.details ? { details: input.details } : {}),
      evidence: input.evidence ?? [],
      attachments: input.attachments ?? [],
      references,
      tags: labels(input.tags),
      confidence: input.confidence ?? "MEDIUM",
      ...(input.requestedAction ? { requestedAction: input.requestedAction } : {}),
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
      votes: [],
      createdAt: now(),
    };
    this.store.boardEntries.set(entry.id, entry);
    this.record("board.entry_posted", input.author, mission.id, "BOARD_ENTRY", entry.id, entry);

    // Strategic board entries can trigger a suggestion to open a decision gate.
    if (["CHALLENGE", "BLOCKER", "PROPOSAL"].includes(input.type) && input.requestedAction) {
      const hasOpenStrategicGate = [...this.store.decisionGates.values()].some(
        (gate) =>
          gate.missionId === mission.id
          && ["MISSION", "RECOVERY"].includes(gate.level)
          && ["PROPOSING", "REVIEWING", "AWAITING_HUMAN"].includes(gate.status),
      );
      if (!hasOpenStrategicGate) {
        const targetHuman = mission.creator.type === "human" ? mission.creator : undefined;
        if (targetHuman) {
          const timestamp = now();
          const request: HumanRequest = {
            id: randomUUID(),
            missionId: mission.id,
            ...(input.taskId ? { taskId: input.taskId } : {}),
            requestedBy: input.author,
            targetHuman,
            kind: "DECISION",
            blocking: false,
            question: `Board ${input.type.toLowerCase()}: ${entry.summary}`,
            reason: `A ${input.type} entry suggests action that may need a mission or recovery-level decision gate: ${input.requestedAction}`,
            status: "OPEN",
            createdAt: timestamp,
            expiresAt: new Date(Date.parse(timestamp) + 72 * 3_600_000).toISOString(),
          };
          this.store.humanRequests.set(request.id, request);
          this.record("human_request.created", input.author, mission.id, "HUMAN_REQUEST", request.id, request);
        }
      }
    }

    return entry;
  }

  queryMissionBoard(input: {
    missionId: string;
    taskId?: string | undefined;
    query?: string | undefined;
    types?: BoardEntryType[] | undefined;
    tags?: string[] | undefined;
    unresolvedOnly?: boolean | undefined;
    after?: string | undefined;
    limit?: number | undefined;
    viewerId?: string | undefined;
  }): MissionBoardBrief {
    const mission = this.mission(input.missionId);
    if (input.taskId) {
      const task = this.task(input.taskId);
      if (task.missionId !== mission.id) throw new DomainError("Task belongs to another mission");
    }
    const requestedTags = labels(input.tags);
    const requestedTypes = input.types ?? [];
    const terms = queryTerms(input.query);
    const unresolvedOnly = input.unresolvedOnly ?? false;
    const limit = input.limit ?? 20;
    const missionEntries = [...this.store.boardEntries.values()].filter((entry) => entry.missionId === mission.id);
    const inbound = new Map<string, BoardEntry[]>();
    for (const candidate of missionEntries) {
      for (const reference of candidate.references) {
        const linked = inbound.get(reference.entryId) ?? [];
        linked.push(candidate);
        inbound.set(reference.entryId, linked);
      }
    }

    const states: BoardEntryState[] = [];
    for (const entry of missionEntries) {
      if (input.taskId && entry.taskId !== input.taskId) continue;
      if (requestedTypes.length > 0 && !requestedTypes.includes(entry.type)) continue;
      if (!requestedTags.every((tag) => entry.tags.includes(tag))) continue;
      if (input.after && Date.parse(entry.createdAt) <= Date.parse(input.after)) continue;
      const linked = inbound.get(entry.id) ?? [];
      const resolvedBy = linked.filter((candidate) => candidate.references.some(
        (reference) => reference.entryId === entry.id && reference.relation === "RESOLVES",
      ));
      const supersededBy = linked.filter((candidate) => candidate.references.some(
        (reference) => reference.entryId === entry.id && reference.relation === "SUPERSEDES",
      ));
      const duplicatedBy = linked.filter((candidate) => candidate.references.some(
        (reference) => reference.entryId === entry.id && reference.relation === "DUPLICATES",
      ));
      const actionable = actionableBoardTypes.has(entry.type) || Boolean(entry.requestedAction);
      const unresolved = actionable && resolvedBy.length === 0 && supersededBy.length === 0 && duplicatedBy.length === 0;
      if (unresolvedOnly && !unresolved) continue;
      const haystack = [entry.type, entry.summary, entry.details ?? "", entry.requestedAction ?? "", ...entry.tags]
        .join(" ")
        .toLowerCase();
      const matchedTerms = terms.filter((term) => haystack.includes(term));
      if (terms.length > 0 && matchedTerms.length === 0) continue;
      const score = matchedTerms.length * 10
        + requestedTags.filter((tag) => entry.tags.includes(tag)).length * 5
        + (unresolved ? 4 : 0)
        + (entry.type === "DECISION" ? 3 : 0)
        + (entry.evidence.length > 0 ? 2 : 0)
        + (entry.confidence === "HIGH" ? 1 : 0);
      states.push({
        entry,
        resolvedBy: resolvedBy.slice(-5),
        supersededBy: supersededBy.slice(-5),
        duplicatedBy: duplicatedBy.slice(-5),
        unresolved,
        score,
        voteCount: entry.votes?.reduce((score, vote) => score + (vote.value === "DOWN" ? -1 : 1), 0) ?? 0,
        upvoteCount: entry.votes?.filter((vote) => vote.value !== "DOWN").length ?? 0,
        downvoteCount: entry.votes?.filter((vote) => vote.value === "DOWN").length ?? 0,
        viewerVote: input.viewerId ? entry.votes?.find((vote) => vote.voterId === input.viewerId)?.value : undefined,
        votedByViewer: Boolean(input.viewerId && entry.votes?.some((vote) => vote.voterId === input.viewerId)),
      });
    }
    states.sort((left, right) => right.score - left.score || right.entry.createdAt.localeCompare(left.entry.createdAt));
    // A thread is the unit rendered by the client. Keep the requested page small,
    // but never cut a selected reply away from its parent or its descendants.
    const stateById = new Map(states.map((state) => [state.entry.id, state]));
    const selectedIds = new Set(states.slice(0, limit).map((state) => state.entry.id));
    const childrenByParent = new Map<string, string[]>();
    for (const candidate of missionEntries) {
      const parent = candidate.references.find((reference) => reference.relation === "REPLIES_TO");
      if (!parent) continue;
      const children = childrenByParent.get(parent.entryId) ?? [];
      children.push(candidate.id);
      childrenByParent.set(parent.entryId, children);
    }
    for (const id of [...selectedIds]) {
      let cursor = stateById.get(id)?.entry;
      while (cursor) {
        const parent = cursor.references.find((reference) => reference.relation === "REPLIES_TO");
        if (!parent || !stateById.has(parent.entryId)) break;
        selectedIds.add(parent.entryId);
        cursor = stateById.get(parent.entryId)?.entry;
      }
      const queue = [...(childrenByParent.get(id) ?? [])];
      while (queue.length) {
        const childId = queue.shift();
        if (!childId || selectedIds.has(childId) || !stateById.has(childId)) continue;
        selectedIds.add(childId);
        queue.push(...(childrenByParent.get(childId) ?? []));
      }
    }
    const entries = states.filter((state) => selectedIds.has(state.entry.id));
    return {
      mission: { id: mission.id, title: mission.title, status: mission.status, tags: mission.tags },
      generatedAt: now(),
      filters: {
        ...(input.taskId ? { taskId: input.taskId } : {}),
        ...(input.query ? { query: input.query } : {}),
        types: requestedTypes,
        tags: requestedTags,
        unresolvedOnly,
        ...(input.after ? { after: input.after } : {}),
        limit,
      },
      entries,
      counts: {
        matched: states.length,
        unresolved: states.filter((state) => state.unresolved).length,
        decisions: states.filter((state) => state.entry.type === "DECISION").length,
        blockers: states.filter((state) => state.entry.type === "BLOCKER").length,
        questions: states.filter((state) => state.entry.type === "QUESTION").length,
        negativeResults: states.filter((state) => state.entry.type === "NEGATIVE_RESULT").length,
      },
    };
  }

  voteOnBoardEntry(input: { missionId: string; entryId: string; voter: Actor; value: "UP" | "DOWN" }): { entryId: string; voteCount: number; upvoteCount: number; downvoteCount: number; viewerVote: "UP" | "DOWN" } {
    const mission = this.mission(input.missionId);
    if (mission.status === "ABANDONED") throw new DomainError("Abandoned missions do not accept board votes");
    const entry = this.boardEntry(input.entryId);
    if (entry.missionId !== mission.id) throw new DomainError("Board entry belongs to another mission");
    const votes = entry.votes ?? (entry.votes = []);
    const existing = votes.find((vote) => vote.voterId === input.voter.id);
    if (existing) existing.value = input.value;
    else {
      const cutoff = Date.now() - 60_000;
      const recentRequests = (this.boardVoteRequests.get(input.voter.id) ?? []).filter((timestamp) => timestamp > cutoff);
      if (recentRequests.length >= 30) throw new DomainError("You can vote on up to 30 board entries per minute");
      recentRequests.push(Date.now());
      this.boardVoteRequests.set(input.voter.id, recentRequests);
      votes.push({ voterId: input.voter.id, value: input.value, createdAt: now() });
    }
    this.record("board.entry_voted", input.voter, mission.id, "BOARD_ENTRY", entry.id, { value: input.value });
    return { entryId: entry.id, voteCount: votes.reduce((score, vote) => score + (vote.value === "DOWN" ? -1 : 1), 0), upvoteCount: votes.filter((vote) => vote.value !== "DOWN").length, downvoteCount: votes.filter((vote) => vote.value === "DOWN").length, viewerVote: input.value };
  }

  missionView(missionId: string) {
    const mission = this.mission(missionId);
    const tasks = [...this.store.tasks.values()].filter((task) => task.missionId === missionId);
    const taskIds = new Set(tasks.map((task) => task.id));
    return {
      mission,
      plans: [...this.store.plans.values()].filter((plan) => plan.missionId === missionId),
      decisionGates: [...this.store.decisionGates.values()].filter((gate) => gate.missionId === missionId),
      decisionProposals: [...this.store.decisionProposals.values()].filter((proposal) => proposal.missionId === missionId),
      decisionBallots: [...this.store.decisionBallots.values()].filter((ballot) => ballot.missionId === missionId),
      tasks,
      claims: [...this.store.claims.values()].filter((claim) =>
        taskIds.has(claim.taskId),
      ),
      contributions: [...this.store.contributions.values()].filter((contribution) =>
        taskIds.has(contribution.taskId),
      ),
      reviews: [...this.store.reviews.values()].filter((review) => {
        const contribution = this.store.contributions.get(review.contributionId);
        const task = contribution ? this.store.tasks.get(contribution.taskId) : undefined;
        return task?.missionId === missionId;
      }),
      humanRequests: [...this.store.humanRequests.values()].filter((request) => request.missionId === missionId),
      delegations: [...this.store.delegations.values()].filter((delegation) => delegation.missionId === missionId),
      repositories: [...this.store.repositoryBindings.values()].filter((binding) => binding.missionId === missionId),
      publications: [...this.store.publications.values()].filter((publication) => publication.missionId === missionId),
      events: this.store.eventsForMission(missionId),
    };
  }

  listMissions(): Mission[] {
    return [...this.store.missions.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  listOpenTasks(missionId?: string): Task[] {
    return [...this.store.tasks.values()].filter(
      (task) => task.status === "OPEN" && (!missionId || task.missionId === missionId),
    );
  }

  listPublications(status: Publication["status"] = "PUBLISHED"): Publication[] {
    return [...this.store.publications.values()]
      .filter((publication) => publication.status === status)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  discoverTasks(input: {
    query?: string | undefined;
    missionId?: string | undefined;
    tags?: string[] | undefined;
    capabilities?: string[] | undefined;
    mode?: Task["mode"] | undefined;
    onlyEligible?: boolean | undefined;
    limit?: number | undefined;
  }): TaskOpportunity[] {
    const requestedTags = labels(input.tags);
    const agentCapabilities = labels(input.capabilities);
    const terms = queryTerms(input.query);
    const onlyEligible = input.onlyEligible ?? true;
    const opportunities: TaskOpportunity[] = [];
    for (const task of this.store.tasks.values()) {
      if (task.status !== "OPEN" || (input.missionId && task.missionId !== input.missionId)) continue;
      if (input.mode && task.mode !== input.mode) continue;
      const mission = this.mission(task.missionId);
      if (mission.status !== "ACTIVE") continue;
      const taskTags = labels([...(mission.tags ?? []), ...(task.tags ?? [])]);
      if (!requestedTags.every((tag) => taskTags.includes(tag))) continue;
      const required = labels(task.requiredCapabilities);
      const matchedCapabilities = required.filter((capability) => agentCapabilities.includes(capability));
      const missingCapabilities = required.filter((capability) => !agentCapabilities.includes(capability));
      if (onlyEligible && agentCapabilities.length > 0 && missingCapabilities.length > 0) continue;
      const haystack = [
        mission.title,
        mission.description,
        task.title,
        task.objective,
        ...task.acceptanceCriteria,
        ...taskTags,
        ...required,
      ].join(" ").toLowerCase();
      const matchedTerms = terms.filter((term) => haystack.includes(term));
      if (terms.length > 0 && matchedTerms.length === 0) continue;
      const matchedTags = requestedTags.filter((tag) => taskTags.includes(tag));
      const score = matchedCapabilities.length * 10 + matchedTags.length * 5 + matchedTerms.length * 3
        + (missingCapabilities.length === 0 ? 4 : 0);
      const reasons = [
        ...(matchedCapabilities.length > 0 ? [`Matches ${matchedCapabilities.length} required capabilities`] : []),
        ...(matchedTags.length > 0 ? [`Matches tags: ${matchedTags.join(", ")}`] : []),
        ...(matchedTerms.length > 0 ? [`Matches search: ${matchedTerms.join(", ")}`] : []),
        ...(missingCapabilities.length === 0 ? ["No known capability gaps"] : []),
      ];
      opportunities.push({ task, mission, matchedCapabilities, missingCapabilities, score, reasons });
    }
    return opportunities
      .sort((left, right) => right.score - left.score || left.task.createdAt.localeCompare(right.task.createdAt))
      .slice(0, input.limit ?? 20);
  }

  discoverMissions(input: {
    query?: string | undefined;
    tags?: string[] | undefined;
    statuses?: Mission["status"][] | undefined;
    limit?: number | undefined;
  }): MissionOpportunity[] {
    const requestedTags = labels(input.tags);
    const terms = queryTerms(input.query);
    const statuses = input.statuses ?? [];
    const results: MissionOpportunity[] = [];
    for (const mission of this.store.missions.values()) {
      if (statuses.length > 0 && !statuses.includes(mission.status)) continue;
      const missionTags = labels(mission.tags);
      if (!requestedTags.every((tag) => missionTags.includes(tag))) continue;
      const tasks = [...this.store.tasks.values()].filter((task) => task.missionId === mission.id);
      const requiredCapabilities = labels(tasks.flatMap((task) => task.requiredCapabilities ?? []));
      const haystack = [mission.title, mission.description, ...missionTags, ...requiredCapabilities]
        .join(" ")
        .toLowerCase();
      const matchedTerms = terms.filter((term) => haystack.includes(term));
      if (terms.length > 0 && matchedTerms.length === 0) continue;
      const openTaskCount = tasks.filter((task) => task.status === "OPEN").length;
      const score = matchedTerms.length * 3 + requestedTags.length * 5 + openTaskCount;
      results.push({ mission, openTaskCount, requiredCapabilities, score });
    }
    return results
      .sort((left, right) => right.score - left.score || right.mission.createdAt.localeCompare(left.mission.createdAt))
      .slice(0, input.limit ?? 20);
  }

  discoverPublications(input: {
    query?: string | undefined;
    tags?: string[] | undefined;
    capabilities?: string[] | undefined;
    limit?: number | undefined;
  }): PublicationOpportunity[] {
    const requestedTags = labels(input.tags);
    const desiredCapabilities = labels(input.capabilities);
    const terms = queryTerms(input.query);
    const results: PublicationOpportunity[] = [];
    for (const publication of this.store.publications.values()) {
      if (publication.status !== "PUBLISHED") continue;
      const publicationTags = labels(publication.tags);
      const publicationCapabilities = labels(publication.capabilities);
      if (!requestedTags.every((tag) => publicationTags.includes(tag))) continue;
      const matchedCapabilities = desiredCapabilities.filter((capability) => publicationCapabilities.includes(capability));
      if (desiredCapabilities.length > 0 && matchedCapabilities.length === 0) continue;
      const haystack = [
        publication.title,
        publication.summary,
        ...publicationTags,
        ...publicationCapabilities,
      ].join(" ").toLowerCase();
      const matchedTerms = terms.filter((term) => haystack.includes(term));
      if (terms.length > 0 && matchedTerms.length === 0) continue;
      const mission = this.mission(publication.missionId);
      const score = matchedCapabilities.length * 10 + requestedTags.length * 5 + matchedTerms.length * 3;
      results.push({ publication, mission, matchedCapabilities, score });
    }
    return results
      .sort((left, right) => right.score - left.score || right.publication.createdAt.localeCompare(left.publication.createdAt))
      .slice(0, input.limit ?? 20);
  }

  private rankDecisionProposals(gateId: string): DecisionRankingEntry[] {
    const proposals = [...this.store.decisionProposals.values()].filter((proposal) => proposal.gateId === gateId);
    const ballots = [...this.store.decisionBallots.values()].filter((ballot) => ballot.gateId === gateId);
    const ranking = new Map<string, DecisionRankingEntry>(proposals.map((proposal) => [proposal.id, {
      proposal,
      agentPoints: 0,
      humanPoints: 0,
      agentFirstChoices: 0,
      humanFirstChoices: 0,
      ballotCount: 0,
      blockingObjections: 0,
      combinedPoints: 0,
    }]));
    const points = [3, 2, 1];
    for (const ballot of ballots) {
      ballot.rankedProposalIds.forEach((proposalId, index) => {
        const entry = ranking.get(proposalId);
        if (!entry) return;
        const score = points[index] ?? 0;
        if (ballot.voter.type === "agent") entry.agentPoints += score;
        else entry.humanPoints += score;
        if (index === 0) {
          if (ballot.voter.type === "agent") entry.agentFirstChoices += 1;
          else entry.humanFirstChoices += 1;
        }
        entry.ballotCount += 1;
      });
      for (const objection of ballot.objections) {
        const entry = ranking.get(objection.proposalId);
        if (entry) entry.blockingObjections += 1;
      }
    }
    for (const entry of ranking.values()) entry.combinedPoints = entry.agentPoints + entry.humanPoints;
    return [...ranking.values()].sort((left, right) =>
      right.combinedPoints - left.combinedPoints
      || (right.agentFirstChoices + right.humanFirstChoices) - (left.agentFirstChoices + left.humanFirstChoices)
      || left.proposal.createdAt.localeCompare(right.proposal.createdAt),
    );
  }

  private pauseDecisionGate(gate: DecisionGate, reason: string, timestamp = now()): void {
    gate.status = "PAUSED";
    gate.selectionReason = reason;
    gate.updatedAt = timestamp;
    this.record("decision_gate.paused", systemActor, gate.missionId, "DECISION_GATE", gate.id, {
      reason,
    });
  }

  private selectDecisionProposalInternal(
    gate: DecisionGate,
    proposal: DecisionProposal,
    actor: Actor,
    reason: string,
    timestamp = now(),
  ): void {
    if (proposal.tasks.length > 0) this.validateDecisionTasks(gate.missionId, proposal.tasks);
    for (const candidate of this.store.decisionProposals.values()) {
      if (candidate.gateId !== gate.id || candidate.status !== "ACTIVE") continue;
      candidate.status = candidate.id === proposal.id ? "SELECTED" : "REJECTED";
    }
    for (const plan of this.store.plans.values()) {
      if (plan.decisionGateId === gate.id && plan.status === "PROPOSED") {
        plan.status = plan.decisionProposalId === proposal.id ? "APPROVED" : "REJECTED";
      }
    }
    gate.status = "SELECTED";
    gate.selectedProposalId = proposal.id;
    gate.selectionReason = reason;
    gate.selectedBy = actor;
    gate.selectedAt = timestamp;
    gate.updatedAt = timestamp;
    if (proposal.tasks.length > 0) this.materializeDecisionTasks(gate, proposal, actor, timestamp);
    this.record("decision_gate.selected", actor, gate.missionId, "DECISION_GATE", gate.id, {
      proposalId: proposal.id,
      reason,
    });
    const mission = this.mission(gate.missionId);
    const targetStatus = this.targetMissionStatusAfterSelection(mission);
    if (targetStatus) this.setMissionStatus(mission, targetStatus, actor);
  }

  private targetMissionStatusAfterSelection(mission: Mission): Mission["status"] | undefined {
    if (mission.status === "ABANDONED") return undefined;
    if (["PROPOSED", "PLANNING", "AWAITING_APPROVAL", "VERIFYING", "COMPLETED"].includes(mission.status)) {
      return "ACTIVE";
    }
    return undefined;
  }

  private materializeDecisionTasks(
    gate: DecisionGate,
    proposal: DecisionProposal,
    actor: Actor,
    timestamp: string,
  ): void {
    this.validateDecisionTasks(gate.missionId, proposal.tasks);
    const existingTasks = [...this.store.tasks.values()].filter((task) => task.missionId === gate.missionId);
    const idByKey = new Map(existingTasks.map((task) => [task.key, task.id]));
    for (const draft of proposal.tasks) idByKey.set(draft.key, randomUUID());
    for (const draft of proposal.tasks) {
      const dependencies = (draft.dependsOn ?? []).map((key) => idByKey.get(key)!);
      const dependencyReady = dependencies.every((id) => this.store.tasks.get(id)?.status === "VERIFIED");
      const task: Task = {
        ...draft,
        id: idByKey.get(draft.key)!,
        missionId: gate.missionId,
        decisionGateId: gate.id,
        dependsOn: dependencies,
        status: dependencies.length === 0 || dependencyReady ? "OPEN" : "BLOCKED",
        createdBy: proposal.proposedBy,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      this.store.tasks.set(task.id, task);
      this.record("task.created_from_decision", actor, gate.missionId, "TASK", task.id, {
        task,
        gateId: gate.id,
        proposalId: proposal.id,
      });
    }
  }

  private validateDecisionTasks(missionId: string, tasks: TaskDraft[]): void {
    const existingKeys = new Set(
      [...this.store.tasks.values()].filter((task) => task.missionId === missionId).map((task) => task.key),
    );
    const newKeys = new Set<string>();
    for (const task of tasks) {
      if (existingKeys.has(task.key) || newKeys.has(task.key)) throw new DomainError(`Duplicate task key: ${task.key}`);
      newKeys.add(task.key);
      if (task.acceptanceCriteria.length === 0) throw new DomainError(`Task ${task.key} requires acceptance criteria`);
    }
    for (const task of tasks) {
      for (const dependency of task.dependsOn ?? []) {
        if (!existingKeys.has(dependency) && !newKeys.has(dependency)) {
          throw new DomainError(`Unknown dependency ${dependency}`);
        }
        if (dependency === task.key) throw new DomainError(`Task ${task.key} cannot depend on itself`);
      }
    }
    const byKey = new Map(tasks.map((task) => [task.key, task]));
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (key: string): void => {
      if (visiting.has(key)) throw new DomainError(`Decision tasks contain a dependency cycle at ${key}`);
      if (visited.has(key)) return;
      visiting.add(key);
      for (const dependency of byKey.get(key)?.dependsOn ?? []) {
        if (byKey.has(dependency)) visit(dependency);
      }
      visiting.delete(key);
      visited.add(key);
    };
    for (const key of newKeys) visit(key);
  }

  private createDecisionReminder(gate: DecisionGate): void {
    if (gate.reminderRequestId) return;
    const mission = this.mission(gate.missionId);
    const targetHuman = mission.creator.type === "human" ? mission.creator : gate.fallbackHuman;
    if (!targetHuman) return;
    const timestamp = now();
    const request: HumanRequest = {
      id: randomUUID(),
      missionId: mission.id,
      ...(gate.taskId ? { taskId: gate.taskId } : {}),
      requestedBy: systemActor,
      targetHuman,
      kind: "DECISION",
      blocking: false,
      question: `Select a proposal for: ${gate.question}`,
      reason: `The review window for ${gate.title} has closed. Review the ranked proposals and objections.`,
      status: "OPEN",
      createdAt: timestamp,
      expiresAt: gate.ownerDecisionClosesAt,
    };
    this.store.humanRequests.set(request.id, request);
    gate.reminderRequestId = request.id;
    this.record("human_request.created", systemActor, mission.id, "HUMAN_REQUEST", request.id, request);
  }

  private createFallbackDecisionReminder(gate: DecisionGate): void {
    if (gate.fallbackReminderRequestId || !gate.fallbackHuman) return;
    const timestamp = now();
    const request: HumanRequest = {
      id: randomUUID(),
      missionId: gate.missionId,
      ...(gate.taskId ? { taskId: gate.taskId } : {}),
      requestedBy: systemActor,
      targetHuman: gate.fallbackHuman,
      kind: "DECISION",
      blocking: false,
      question: `The owner did not decide: select a proposal for ${gate.question}`,
      reason: `You were pre-authorized as fallback steward for ${gate.title}. Review the ranked proposals and objections.`,
      status: "OPEN",
      createdAt: timestamp,
      expiresAt: new Date(Date.parse(timestamp) + 72 * 3_600_000).toISOString(),
    };
    this.store.humanRequests.set(request.id, request);
    gate.fallbackReminderRequestId = request.id;
    this.record("human_request.created", systemActor, gate.missionId, "HUMAN_REQUEST", request.id, request);
  }

  private validatePlan(tasks: TaskDraft[]): void {
    if (tasks.length === 0) throw new DomainError("A plan requires at least one task");
    const keys = new Set<string>();
    for (const task of tasks) {
      if (keys.has(task.key)) throw new DomainError(`Duplicate task key: ${task.key}`);
      keys.add(task.key);
      if (task.acceptanceCriteria.length === 0) {
        throw new DomainError(`Task ${task.key} requires acceptance criteria`);
      }
    }
    for (const task of tasks) {
      for (const dependency of task.dependsOn ?? []) {
        if (!keys.has(dependency)) throw new DomainError(`Unknown dependency ${dependency}`);
        if (dependency === task.key) throw new DomainError(`Task ${task.key} cannot depend on itself`);
      }
    }
  }

  private assertAgentTextLength(author: Actor, fields: Record<string, string | undefined>, limits: Record<string, number>): void {
    if (author.type !== "agent") return;
    for (const [key, value] of Object.entries(fields)) {
      if (!value) continue;
      const limit = limits[key];
      if (limit !== undefined && value.length > limit) {
        throw new DomainError(`Agent ${key} must be at most ${limit} characters`);
      }
    }
  }

  private assertAgentListLength(author: Actor, name: string, values: unknown[] | undefined, limit: number): void {
    if (author.type !== "agent") return;
    if ((values ?? []).length > limit) {
      throw new DomainError(`Agent ${name} must have at most ${limit} items`);
    }
  }

  private assertMissionController(mission: Mission, actor: Actor): void {
    if (mission.creator.id === actor.id) return;
    if (actor.type === "agent" && this.activeDelegation(mission.id, actor.id)) return;
    throw new DomainError("Only the mission owner or an agent authorized by that owner can perform this action");
  }

  private assertHumanMissionOwner(mission: Mission, actor: Actor): void {
    if (actor.type === "human" && mission.creator.type === "human" && mission.creator.id === actor.id) return;
    throw new DomainError("Only the human mission owner can perform this control action");
  }

  private activeDelegation(missionId: string, agentId: string): AgentDelegation | undefined {
    return [...this.store.delegations.values()].find(
      (delegation) =>
        delegation.missionId === missionId
        && delegation.agent.id === agentId
        && delegation.status === "ACTIVE",
    );
  }

  private taskAndDependents(taskId: string): Task[] {
    const result: Task[] = [];
    const pending = [taskId];
    const seen = new Set<string>();
    while (pending.length > 0) {
      const currentId = pending.shift()!;
      if (seen.has(currentId)) continue;
      seen.add(currentId);
      const current = this.task(currentId);
      result.push(current);
      for (const candidate of this.store.tasks.values()) {
        if (candidate.missionId === current.missionId && (candidate.dependsOn ?? []).includes(currentId)) {
          pending.push(candidate.id);
        }
      }
    }
    return result;
  }

  private releaseTaskClaims(task: Task, actor: Actor, reason: string): void {
    for (const claim of this.store.claims.values()) {
      if (claim.taskId === task.id && claim.status === "ACTIVE") {
        claim.status = "RELEASED";
        this.record("claim.released", actor, task.missionId, "CLAIM", claim.id, { reason });
      }
    }
  }

  private expireTaskHumanRequests(taskId: string, actor: Actor, reason: string): void {
    for (const request of this.store.humanRequests.values()) {
      if (request.taskId === taskId && request.status === "OPEN") {
        transitions.humanRequest(request.status, "EXPIRED");
        request.status = "EXPIRED";
        request.expiredAt = now();
        this.record("human_request.expired", actor, request.missionId, "HUMAN_REQUEST", request.id, { reason });
      }
    }
  }

  private resolveHumanTarget(
    mission: Mission,
    input: {
      requestedBy: Actor;
      targetHumanId?: string | undefined;
      targetHumanDisplayName?: string | undefined;
    },
  ): Actor {
    if (mission.creator.type === "human") return mission.creator;
    const delegation = this.activeDelegation(mission.id, input.requestedBy.id);
    if (delegation) return delegation.grantedBy;
    if (input.targetHumanId && input.targetHumanDisplayName) {
      return {
        id: input.targetHumanId,
        type: "human",
        displayName: input.targetHumanDisplayName,
      };
    }
    throw new DomainError("This mission has no human owner; address the request to a specific human");
  }

  private openUnblockedTasks(missionId: string, actor: Actor): void {
    const tasks = [...this.store.tasks.values()].filter((task) => task.missionId === missionId);
    for (const task of tasks.filter((candidate) => candidate.status === "BLOCKED")) {
      const dependencies = task.dependsOn ?? [];
      const waitingForHuman = [...this.store.humanRequests.values()].some(
        (request) => request.taskId === task.id && request.blocking && request.status === "OPEN",
      );
      if (!waitingForHuman && dependencies.every((id) => this.task(id).status === "VERIFIED")) {
        this.setTaskStatus(task, "OPEN", actor);
      }
    }
  }

  private checkMilestoneCompletion(missionId: string, actor: Actor): void {
    const mission = this.mission(missionId);
    const milestoneGates = [...this.store.decisionGates.values()].filter(
      (gate) => gate.missionId === missionId && gate.level === "MILESTONE" && gate.status === "SELECTED",
    );
    for (const gate of milestoneGates) {
      if (gate.nextForkSuggestedAt) continue;
      const gateTasks = [...this.store.tasks.values()].filter(
        (task) => task.missionId === missionId && task.decisionGateId === gate.id,
      );
      if (gateTasks.length === 0) continue;
      const allResolved = gateTasks.every((task) => task.status === "VERIFIED" || task.status === "CANCELLED");
      if (!allResolved) continue;

      const hasOpenFollowUp = [...this.store.decisionGates.values()].some(
        (other) =>
          other.missionId === missionId
          && other.level === "MILESTONE"
          && other.id !== gate.id
          && ["PROPOSING", "REVIEWING", "AWAITING_HUMAN"].includes(other.status),
      );
      if (hasOpenFollowUp) continue;

      const targetHuman = mission.creator.type === "human" ? mission.creator : undefined;
      gate.nextForkSuggestedAt = now();
      gate.updatedAt = now();
      this.record("decision_gate.next_fork_suggested", systemActor, missionId, "DECISION_GATE", gate.id, {
        reason: "All milestone tasks are resolved and no follow-up gate is open",
      });

      if (!targetHuman) continue;
      const timestamp = now();
      const request: HumanRequest = {
        id: randomUUID(),
        missionId: mission.id,
        requestedBy: systemActor,
        targetHuman,
        kind: "DECISION",
        blocking: false,
        question: `Milestone "${gate.title}" is complete. What should the next milestone build?`,
        reason: `All tasks from milestone gate "${gate.title}" are verified or cancelled. Open a new milestone decision gate to propose the next path.`,
        status: "OPEN",
        createdAt: timestamp,
        expiresAt: new Date(Date.parse(timestamp) + 72 * 3_600_000).toISOString(),
      };
      this.store.humanRequests.set(request.id, request);
      this.record("human_request.created", systemActor, mission.id, "HUMAN_REQUEST", request.id, request);
    }
  }

  private resetNextForkSuggestionForGate(gateId: string, reason: string): void {
    const gate = this.store.decisionGates.get(gateId);
    if (!gate || gate.level !== "MILESTONE" || !gate.nextForkSuggestedAt) return;
    gate.nextForkSuggestedAt = undefined;
    gate.updatedAt = now();
    this.record("decision_gate.next_fork_reset", systemActor, gate.missionId, "DECISION_GATE", gate.id, { reason });
  }

  private setMissionStatus(mission: Mission, status: Mission["status"], actor: Actor): void {
    transitions.mission(mission.status, status);
    const from = mission.status;
    mission.status = status;
    mission.updatedAt = now();
    this.record("mission.status_changed", actor, mission.id, "MISSION", mission.id, { from, to: status });
  }

  private setTaskStatus(task: Task, status: Task["status"], actor: Actor): void {
    transitions.task(task.status, status);
    const from = task.status;
    task.status = status;
    task.updatedAt = now();
    this.record("task.status_changed", actor, task.missionId, "TASK", task.id, { from, to: status });
  }

  private record(
    type: string,
    actor: Actor,
    missionId: string,
    entityType: DomainEvent["entityType"],
    entityId: string,
    payload: unknown,
  ): void {
    const delegation = actor.type === "agent" ? this.activeDelegation(missionId, actor.id) : undefined;
    this.store.events.push({
      id: randomUUID(),
      sequence: this.store.events.length + 1,
      type,
      actor,
      ...(delegation ? { authority: { delegationId: delegation.id, grantedBy: delegation.grantedBy } } : {}),
      missionId,
      entityType,
      entityId,
      occurredAt: now(),
      payload,
    });
  }

  private mission(id: string): Mission {
    const value = this.store.missions.get(id);
    if (!value) throw new DomainError(`Mission ${id} not found`);
    return value;
  }

  private plan(id: string): PlanProposal {
    const value = this.store.plans.get(id);
    if (!value) throw new DomainError(`Plan ${id} not found`);
    return value;
  }

  private decisionGate(id: string): DecisionGate {
    const value = this.store.decisionGates.get(id);
    if (!value) throw new DomainError(`Decision gate ${id} not found`);
    return value;
  }

  private decisionProposal(id: string): DecisionProposal {
    const value = this.store.decisionProposals.get(id);
    if (!value) throw new DomainError(`Decision proposal ${id} not found`);
    return value;
  }

  private task(id: string): Task {
    const value = this.store.tasks.get(id);
    if (!value) throw new DomainError(`Task ${id} not found`);
    return value;
  }

  private claim(id: string): Claim {
    const value = this.store.claims.get(id);
    if (!value) throw new DomainError(`Claim ${id} not found`);
    return value;
  }

  private contribution(id: string): Contribution {
    const value = this.store.contributions.get(id);
    if (!value) throw new DomainError(`Contribution ${id} not found`);
    return value;
  }

  private humanRequest(id: string): HumanRequest {
    const value = this.store.humanRequests.get(id);
    if (!value) throw new DomainError(`Human request ${id} not found`);
    return value;
  }

  private publication(id: string): Publication {
    const value = this.store.publications.get(id);
    if (!value) throw new DomainError(`Publication ${id} not found`);
    return value;
  }

  private boardEntry(id: string): BoardEntry {
    const value = this.store.boardEntries.get(id);
    if (!value) throw new DomainError(`Board entry ${id} not found`);
    return value;
  }
}
