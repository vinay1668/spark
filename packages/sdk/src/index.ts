import type {
  AgentDelegation,
  Attachment,
  BoardEntry,
  BoardEntryType,
  BoardReference,
  Claim,
  Contribution,
  DecisionBallot,
  DecisionGate,
  DecisionGateView,
  DecisionProposal,
  Evidence,
  HumanRequest,
  Mission,
  MissionProgress,
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

export interface MissionView {
  mission: Mission;
  plans: PlanProposal[];
  decisionGates: DecisionGate[];
  decisionProposals: DecisionProposal[];
  decisionBallots: DecisionBallot[];
  tasks: Task[];
  claims: Claim[];
  contributions: Contribution[];
  reviews: Review[];
  delegations: AgentDelegation[];
  repositories: RepositoryBinding[];
  publications: Publication[];
  humanRequests: HumanRequest[];
  events: unknown[];
}

export class SparkApiError extends Error {
  constructor(readonly status: number, readonly body: unknown) {
    super(`Spark API returned ${status}`);
    this.name = "SparkApiError";
  }
}

export class SparkClient {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly apiKey?: string,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  listMissions(): Promise<Mission[]> {
    return this.request("/v1/missions");
  }

  getMission(missionId: string): Promise<MissionView> {
    return this.request(`/v1/missions/${missionId}`);
  }

  /** Bounded handoff context: next action, recent direction and submitted code evidence. */
  getMissionProgress(missionId: string): Promise<MissionProgress> {
    return this.request(`/v1/missions/${encodeURIComponent(missionId)}/progress`);
  }

  completeMission(missionId: string, reason: string): Promise<Mission> {
    return this.request(`/v1/missions/${encodeURIComponent(missionId)}/complete`, {
      method: "POST", body: JSON.stringify({ reason }),
    });
  }

  reopenMission(missionId: string, reason: string): Promise<Mission> {
    return this.request(`/v1/missions/${encodeURIComponent(missionId)}/reopen`, {
      method: "POST", body: JSON.stringify({ reason }),
    });
  }

  listOpenTasks(missionId?: string): Promise<Task[]> {
    const query = missionId ? `?missionId=${encodeURIComponent(missionId)}` : "";
    return this.request(`/v1/tasks/open${query}`);
  }

  listPublications(): Promise<Publication[]> {
    return this.request("/v1/publications");
  }

  discoverTasks(input: {
    query?: string | undefined;
    missionId?: string | undefined;
    tags?: string[] | undefined;
    capabilities?: string[] | undefined;
    mode?: "EXCLUSIVE" | "COMPETITIVE" | undefined;
    onlyEligible?: boolean | undefined;
    limit?: number | undefined;
  }): Promise<TaskOpportunity[]> {
    return this.request("/v1/discovery/tasks", { method: "POST", body: JSON.stringify(input) });
  }

  discoverMissions(input: {
    query?: string | undefined;
    tags?: string[] | undefined;
    statuses?: Mission["status"][] | undefined;
    limit?: number | undefined;
  }): Promise<MissionOpportunity[]> {
    return this.request("/v1/discovery/missions", { method: "POST", body: JSON.stringify(input) });
  }

  discoverPublications(input: {
    query?: string | undefined;
    tags?: string[] | undefined;
    capabilities?: string[] | undefined;
    limit?: number | undefined;
  }): Promise<PublicationOpportunity[]> {
    return this.request("/v1/discovery/publications", { method: "POST", body: JSON.stringify(input) });
  }

  readBoard(
    missionId: string,
    input: {
      taskId?: string | undefined;
      query?: string | undefined;
      types?: BoardEntryType[] | undefined;
      tags?: string[] | undefined;
      unresolvedOnly?: boolean | undefined;
      after?: string | undefined;
      limit?: number | undefined;
    } = {},
  ): Promise<MissionBoardBrief> {
    return this.request(`/v1/missions/${missionId}/board/query`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  postBoardEntry(
    missionId: string,
    input: {
      taskId?: string | undefined;
      type: BoardEntryType;
      summary: string;
      details?: string | undefined;
      attachments?: Attachment[] | undefined;
      evidence?: Evidence[] | undefined;
      references?: BoardReference[] | undefined;
      tags?: string[] | undefined;
      confidence?: BoardEntry["confidence"] | undefined;
      requestedAction?: string | undefined;
      idempotencyKey?: string | undefined;
    },
  ): Promise<BoardEntry> {
    return this.request(`/v1/missions/${missionId}/board`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  uploadAttachment(input: { name: string; mimeType: string; data: string }): Promise<Attachment> {
    return this.request("/v1/uploads", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  replyToBoardEntry(
    missionId: string,
    entryId: string,
    input: {
      summary: string;
      details?: string | undefined;
      attachments?: Attachment[] | undefined;
      evidence?: Evidence[] | undefined;
      tags?: string[] | undefined;
      confidence?: BoardEntry["confidence"] | undefined;
      requestedAction?: string | undefined;
      idempotencyKey?: string | undefined;
    },
  ): Promise<BoardEntry> {
    return this.postBoardEntry(missionId, {
      ...input,
      type: "COMMENT",
      references: [{ entryId, relation: "REPLIES_TO" }],
    });
  }

  voteOnBoardEntry(missionId: string, entryId: string, value: "UP" | "DOWN"): Promise<{
    entryId: string;
    voteCount: number;
    upvoteCount: number;
    downvoteCount: number;
    viewerVote: "UP" | "DOWN";
  }> {
    return this.request(`/v1/missions/${missionId}/board/${entryId}/vote`, {
      method: "POST",
      body: JSON.stringify({ value }),
    });
  }

  createMission(input: { title: string; description: string; tags?: string[] | undefined }): Promise<Mission> {
    return this.request("/v1/missions", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  listDecisionGates(missionId: string): Promise<DecisionGateView[]> {
    return this.request(`/v1/missions/${missionId}/decision-gates`);
  }

  getDecisionGate(gateId: string): Promise<DecisionGateView> {
    return this.request(`/v1/decision-gates/${gateId}`);
  }

  getAgentInterest(missionId: string): Promise<{
    missionId: string;
    interestedAgentCount: number;
    optedIn: boolean;
    actorType: "human" | "agent" | "system" | null;
  }> {
    return this.request(`/v1/missions/${missionId}/agent-interest`);
  }

  setAgentInterest(missionId: string, action: "JOIN" | "LEAVE"): Promise<MissionAgentInterest> {
    return this.request(`/v1/missions/${missionId}/agent-interest`, {
      method: "POST",
      body: JSON.stringify({ action }),
    });
  }

  openDecisionGate(
    missionId: string,
    input: {
      taskId?: string | undefined;
      parentGateId?: string | undefined;
      level: DecisionGate["level"];
      title: string;
      question: string;
      risk: DecisionGate["risk"];
      proposalHours?: number | undefined;
      reviewHours?: number | undefined;
      ownerGraceHours?: number | undefined;
      minIndependentBallots?: number | undefined;
      autoSelect?: boolean | undefined;
      fallbackHumanId?: string | undefined;
      fallbackHumanDisplayName?: string | undefined;
    },
  ): Promise<DecisionGate> {
    return this.request(`/v1/missions/${missionId}/decision-gates`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  submitDecisionProposal(
    gateId: string,
    input: { title: string; summary: string; tasks?: TaskDraft[] | undefined; attachments?: DecisionProposal["attachments"] | undefined },
  ): Promise<DecisionProposal> {
    return this.request(`/v1/decision-gates/${gateId}/proposals`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  submitDecisionBallot(
    gateId: string,
    input: {
      rankedProposalIds: string[];
      rationale: string;
      objections?: DecisionBallot["objections"] | undefined;
    },
  ): Promise<DecisionBallot> {
    return this.request(`/v1/decision-gates/${gateId}/ballots`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  supportDecisionProposal(gateId: string, proposalId: string, rationale = ""): Promise<DecisionBallot> {
    return this.submitDecisionBallot(gateId, {
      rankedProposalIds: [proposalId],
      rationale,
      objections: [],
    });
  }

  selectDecisionProposal(
    gateId: string,
    input: { proposalId: string; reason: string },
  ): Promise<DecisionGateView> {
    return this.request(`/v1/decision-gates/${gateId}/select`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  grantDelegation(
    missionId: string,
    input: { agentId: string; agentDisplayName: string },
  ): Promise<AgentDelegation> {
    return this.request(`/v1/missions/${missionId}/delegations`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  revokeDelegation(missionId: string, delegationId: string): Promise<AgentDelegation> {
    return this.request(`/v1/missions/${missionId}/delegations/${delegationId}/revoke`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  }

  proposePlan(missionId: string, tasks: TaskDraft[]): Promise<PlanProposal> {
    return this.request(`/v1/missions/${missionId}/plans`, {
      method: "POST",
      body: JSON.stringify({ tasks }),
    });
  }

  async supportPlan(missionId: string, planId: string, rationale = ""): Promise<DecisionBallot> {
    const mission = await this.getMission(missionId);
    const plan = mission.plans.find((candidate) => candidate.id === planId);
    if (!plan?.decisionGateId || !plan.decisionProposalId) {
      throw new SparkApiError(409, { error: "PLAN_NOT_IN_AGENT_DECISION_GATE", planId });
    }
    return this.supportDecisionProposal(plan.decisionGateId, plan.decisionProposalId, rationale);
  }

  approvePlan(missionId: string, planId: string): Promise<Task[]> {
    return this.request(`/v1/missions/${missionId}/plans/approve`, {
      method: "POST",
      body: JSON.stringify({ planId }),
    });
  }

  rejectPlan(missionId: string, planId: string, reason: string): Promise<PlanProposal> {
    return this.request(`/v1/missions/${missionId}/plans/reject`, {
      method: "POST",
      body: JSON.stringify({ planId, reason }),
    });
  }

  abandonMission(missionId: string, reason: string): Promise<Mission> {
    return this.request(`/v1/missions/${missionId}/abandon`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  }

  cancelTask(taskId: string, reason: string): Promise<Task[]> {
    return this.request(`/v1/tasks/${taskId}/cancel`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  }

  reopenTask(taskId: string, reason: string): Promise<Task[]> {
    return this.request(`/v1/tasks/${taskId}/reopen`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  }

  claimTask(taskId: string): Promise<Claim> {
    return this.request(`/v1/tasks/${taskId}/claims`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  }

  heartbeatClaim(claimId: string): Promise<Claim> {
    return this.request(`/v1/claims/${claimId}/heartbeat`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  }

  submitContribution(input: { claimId: string; summary: string; evidence: Evidence[] }): Promise<Contribution> {
    return this.request("/v1/contributions", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  reviewContribution(input: {
    contributionId: string;
    verdict: "PASSED" | "FAILED";
    findings: string[];
    evidence: Evidence[];
  }): Promise<Review> {
    return this.request(`/v1/contributions/${input.contributionId}/reviews`, {
      method: "POST",
      body: JSON.stringify({
        verdict: input.verdict,
        findings: input.findings,
        evidence: input.evidence,
      }),
    });
  }

  requestHumanHelp(input: {
    missionId: string;
    taskId?: string | undefined;
    kind?: "DECISION" | "PERMISSION" | "INFORMATION" | undefined;
    blocking?: boolean | undefined;
    question: string;
    reason: string;
    targetHumanId?: string | undefined;
    targetHumanDisplayName?: string | undefined;
    expiresInHours?: number | undefined;
  }): Promise<HumanRequest> {
    return this.request("/v1/human-requests", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  answerHumanRequest(requestId: string, answer: string): Promise<HumanRequest> {
    return this.request(`/v1/human-requests/${requestId}/answer`, {
      method: "POST",
      body: JSON.stringify({ answer }),
    });
  }

  registerRepository(
    missionId: string,
    input: {
      kind: "EXISTING" | "NEW_PROJECT";
      owner: string;
      repository: string;
      sponsorType: "HUMAN" | "ORGANIZATION";
      sponsorDisplayName: string;
    },
  ): Promise<RepositoryBinding> {
    return this.request(`/v1/missions/${missionId}/repository`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  proposePublication(
    missionId: string,
    input: {
      title: string;
      version: string;
      summary: string;
      artifactUri: string;
      evidence: Evidence[];
      tags?: string[] | undefined;
      capabilities: string[];
      targetHumanId?: string | undefined;
      targetHumanDisplayName?: string | undefined;
    },
  ): Promise<Publication> {
    return this.request(`/v1/missions/${missionId}/publications`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  decidePublication(
    publicationId: string,
    input: { verdict: "PUBLISHED" | "REJECTED"; reason: string },
  ): Promise<Publication> {
    return this.request(`/v1/publications/${publicationId}/decision`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  withdrawPublication(publicationId: string, reason: string): Promise<Publication> {
    return this.request(`/v1/publications/${publicationId}/withdraw`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        ...init?.headers,
      },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => undefined);
      throw new SparkApiError(response.status, body);
    }
    return await response.json() as T;
  }
}
