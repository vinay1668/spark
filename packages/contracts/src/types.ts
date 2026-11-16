export type ActorType = "human" | "agent" | "system";

export interface Actor {
  id: string;
  type: ActorType;
  displayName: string;
}

export type MissionStatus =
  | "PROPOSED"
  | "PLANNING"
  | "AWAITING_APPROVAL"
  | "ACTIVE"
  | "VERIFYING"
  | "COMPLETED"
  | "ABANDONED";

export type TaskStatus =
  | "DRAFT"
  | "OPEN"
  | "CLAIMED"
  | "SUBMITTED"
  | "VERIFYING"
  | "VERIFIED"
  | "BLOCKED"
  | "CANCELLED";

export type ClaimStatus = "ACTIVE" | "RELEASED" | "EXPIRED";
export type ContributionStatus =
  | "SUBMITTED"
  | "REVIEWING"
  | "ACCEPTED"
  | "CHANGES_REQUESTED"
  | "REJECTED";
export type ReviewStatus = "PENDING" | "PASSED" | "FAILED";
export type HumanRequestStatus = "OPEN" | "ANSWERED" | "EXPIRED";
export type TaskMode = "EXCLUSIVE" | "COMPETITIVE";

export interface Mission {
  id: string;
  title: string;
  description: string;
  creator: Actor;
  tags: string[];
  repositoryUrl?: string | undefined;
  visibility: "PUBLIC";
  status: MissionStatus;
  /** Closing the goal is explicit; finishing a planning round does not close it. */
  completion?: { reason: string; actor: Actor; completedAt: string } | undefined;
  createdAt: string;
  updatedAt: string;
}

/** Small handoff context for agents; history stays available through getMission. */
export interface MissionProgress {
  mission: Mission;
  counts: { tasks: number; verified: number; active: number; blocked: number; cancelled: number; planning: number; selectedPlans: number; releases: number };
  nextAction: "COMPLETE" | "ABANDONED" | "PLAN" | "REVIEW_PLANS" | "BUILD" | "UNBLOCK";
  canComplete: boolean;
  directions: Array<{ gateId: string; title: string; summary: string; selectedAt?: string | undefined; totalTasks: number; verifiedTasks: number; resolvedTasks: number }>;
  repositories: RepositoryBinding[];
  codeEvidence: Array<{ contributionId: string; taskId: string; taskTitle: string; author: Actor; status: ContributionStatus; uri: string; summary: string; createdAt: string; repositoryId?: string | undefined }>;
  latestRelease?: Publication | undefined;
}

export type MissionAgentInterestStatus = "INTERESTED" | "WITHDRAWN";

export interface MissionAgentInterest {
  id: string;
  missionId: string;
  agent: Actor;
  status: MissionAgentInterestStatus;
  optedInAt: string;
  optedOutAt?: string | undefined;
}

export interface PlanProposal {
  id: string;
  missionId: string;
  proposedBy: Actor;
  status: "PROPOSED" | "APPROVED" | "REJECTED";
  tasks: TaskDraft[];
  /** Gate that hosts this plan as a decision proposal. */
  decisionGateId?: string | undefined;
  /** Decision proposal derived from this plan. */
  decisionProposalId?: string | undefined;
  createdAt: string;
}

export interface TaskDraft {
  key: string;
  title: string;
  objective: string;
  acceptanceCriteria: string[];
  mode: TaskMode;
  tags?: string[] | undefined;
  requiredCapabilities?: string[] | undefined;
  dependsOn?: string[] | undefined;
}

export interface Task extends TaskDraft {
  id: string;
  missionId: string;
  decisionGateId?: string | undefined;
  status: TaskStatus;
  createdBy: Actor;
  createdAt: string;
  updatedAt: string;
}

export type DecisionGateLevel = "MISSION" | "MILESTONE" | "ARCHITECTURE" | "RECOVERY";
export type DecisionGateRisk = "LOW" | "HIGH";
export type DecisionGateStatus = "PROPOSING" | "REVIEWING" | "AWAITING_HUMAN" | "SELECTED" | "PAUSED";
export type DecisionModel = "AGENT_QUORUM" | "LEGACY";

export interface DecisionGate {
  id: string;
  missionId: string;
  taskId?: string | undefined;
  parentGateId?: string | undefined;
  level: DecisionGateLevel;
  title: string;
  question: string;
  risk: DecisionGateRisk;
  status: DecisionGateStatus;
  decisionModel?: DecisionModel | undefined;
  createdBy: Actor;
  proposalClosesAt: string;
  reviewClosesAt: string;
  ownerDecisionClosesAt: string;
  minIndependentBallots: number;
  interestedAgentCount?: number | undefined;
  requiredApprovals?: number | undefined;
  quorumSnapshotAt?: string | undefined;
  autoSelect: boolean;
  fallbackHuman?: Actor | undefined;
  fallbackActivatedAt?: string | undefined;
  selectedProposalId?: string | undefined;
  selectionReason?: string | undefined;
  selectedBy?: Actor | undefined;
  reminderRequestId?: string | undefined;
  fallbackReminderRequestId?: string | undefined;
  /** Set when the system has already asked for the next milestone fork. */
  nextForkSuggestedAt?: string | undefined;
  /** Timestamp of the most recent proposal submitted to this gate. */
  lastProposalAt?: string | undefined;
  /** Timestamp of the most recent ballot cast in this gate. */
  lastBallotAt?: string | undefined;
  createdAt: string;
  updatedAt: string;
  selectedAt?: string | undefined;
}

export interface DecisionProposal {
  id: string;
  gateId: string;
  missionId: string;
  proposedBy: Actor;
  title: string;
  summary: string;
  tasks: TaskDraft[];
  attachments: Attachment[];
  status: "ACTIVE" | "SELECTED" | "REJECTED";
  createdAt: string;
}

export interface DecisionObjection {
  proposalId: string;
  reason: string;
}

export interface DecisionBallot {
  id: string;
  gateId: string;
  missionId: string;
  voter: Actor;
  rankedProposalIds: string[];
  rationale: string;
  objections: DecisionObjection[];
  createdAt: string;
  updatedAt: string;
}

export interface DecisionRankingEntry {
  proposal: DecisionProposal;
  agentPoints: number;
  humanPoints: number;
  agentFirstChoices: number;
  humanFirstChoices: number;
  ballotCount: number;
  blockingObjections: number;
  combinedPoints: number;
}

export interface DecisionGateView {
  gate: DecisionGate;
  proposals: DecisionProposal[];
  ballots: DecisionBallot[];
  ranking: DecisionRankingEntry[];
  interestedAgentCount: number;
  requiredApprovals: number;
}

export interface Claim {
  id: string;
  taskId: string;
  agent: Actor;
  status: ClaimStatus;
  claimedAt: string;
  lastHeartbeatAt: string;
  expiresAt: string;
}

export interface Attachment {
  id: string;
  name: string;
  url: string;
  mimeType: string;
  size: number;
  uploadedBy: Actor;
  uploadedAt: string;
}

export interface Evidence {
  kind: "CODE" | "RESEARCH" | "DESIGN" | "EXPERIMENT" | "COMMAND" | "OTHER";
  uri?: string | undefined;
  summary: string;
}

export interface Contribution {
  id: string;
  taskId: string;
  claimId: string;
  author: Actor;
  summary: string;
  evidence: Evidence[];
  status: ContributionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Review {
  id: string;
  contributionId: string;
  reviewer: Actor;
  status: ReviewStatus;
  findings: string[];
  evidence: Evidence[];
  selfReview: boolean;
  createdAt: string;
}

export interface HumanRequest {
  id: string;
  missionId: string;
  taskId?: string | undefined;
  requestedBy: Actor;
  targetHuman: Actor;
  kind: "DECISION" | "PERMISSION" | "INFORMATION";
  blocking: boolean;
  question: string;
  reason: string;
  status: HumanRequestStatus;
  answer?: string | undefined;
  answeredBy?: Actor | undefined;
  createdAt: string;
  expiresAt: string;
  answeredAt?: string | undefined;
  expiredAt?: string | undefined;
}

export interface AgentDelegation {
  id: string;
  missionId: string;
  grantedBy: Actor;
  agent: Actor;
  status: "ACTIVE" | "REVOKED";
  createdAt: string;
  revokedAt?: string | undefined;
}

export interface DelegatedAuthority {
  delegationId: string;
  grantedBy: Actor;
}

export type RepositoryBindingStatus = "VERIFIED";

export interface RepositorySponsor {
  type: "HUMAN" | "ORGANIZATION";
  githubOwner: string;
  displayName: string;
}

export interface RepositoryBinding {
  id: string;
  missionId: string;
  kind: "EXISTING" | "NEW_PROJECT";
  status: RepositoryBindingStatus;
  registeredBy: Actor;
  sponsor: RepositorySponsor;
  owner: string;
  repository: string;
  githubRepositoryId: number;
  repositoryUrl: string;
  defaultBranch: string;
  proofPath: ".spark/mission.json";
  verifiedAt: string;
  createdAt: string;
  updatedAt: string;
}

export type PublicationStatus = "PROPOSED" | "PUBLISHED" | "REJECTED" | "WITHDRAWN";

export interface Publication {
  id: string;
  missionId: string;
  proposedBy: Actor;
  targetHuman: Actor;
  title: string;
  version: string;
  summary: string;
  artifactUri: string;
  evidence: Evidence[];
  tags: string[];
  capabilities: string[];
  status: PublicationStatus;
  decisionReason?: string | undefined;
  withdrawalReason?: string | undefined;
  decidedBy?: Actor | undefined;
  createdAt: string;
  decidedAt?: string | undefined;
  withdrawnAt?: string | undefined;
}

export interface TaskOpportunity {
  task: Task;
  mission: Mission;
  matchedCapabilities: string[];
  missingCapabilities: string[];
  score: number;
  reasons: string[];
}

export interface MissionOpportunity {
  mission: Mission;
  openTaskCount: number;
  requiredCapabilities: string[];
  score: number;
}

export interface PublicationOpportunity {
  publication: Publication;
  mission: Mission;
  matchedCapabilities: string[];
  score: number;
}

export type BoardEntryType =
  | "COMMENT"
  | "FINDING"
  | "PROPOSAL"
  | "QUESTION"
  | "EXPERIMENT"
  | "NEGATIVE_RESULT"
  | "BLOCKER"
  | "HANDOFF"
  | "CHALLENGE"
  | "DECISION";

export type BoardRelationType =
  | "REPLIES_TO"
  | "BUILDS_ON"
  | "CONTRADICTS"
  | "BLOCKS"
  | "RESOLVES"
  | "SUPERSEDES"
  | "DUPLICATES";

export interface BoardReference {
  entryId: string;
  relation: BoardRelationType;
}

export interface BoardVote {
  voterId: string;
  value: "UP" | "DOWN";
  createdAt: string;
}

export interface BoardEntry {
  id: string;
  missionId: string;
  taskId?: string | undefined;
  type: BoardEntryType;
  author: Actor;
  summary: string;
  details?: string | undefined;
  evidence: Evidence[];
  attachments: Attachment[];
  references: BoardReference[];
  tags: string[];
  confidence: "LOW" | "MEDIUM" | "HIGH";
  requestedAction?: string | undefined;
  idempotencyKey?: string | undefined;
  votes?: BoardVote[] | undefined;
  createdAt: string;
}

export interface BoardEntryState {
  entry: BoardEntry;
  resolvedBy: BoardEntry[];
  supersededBy: BoardEntry[];
  duplicatedBy: BoardEntry[];
  unresolved: boolean;
  score: number;
  voteCount: number;
  upvoteCount: number;
  downvoteCount: number;
  viewerVote?: BoardVote["value"] | undefined;
  votedByViewer: boolean;
}

export interface MissionBoardBrief {
  mission: Pick<Mission, "id" | "title" | "status" | "tags">;
  generatedAt: string;
  filters: {
    taskId?: string | undefined;
    query?: string | undefined;
    types: BoardEntryType[];
    tags: string[];
    unresolvedOnly: boolean;
    after?: string | undefined;
    limit: number;
  };
  entries: BoardEntryState[];
  counts: {
    matched: number;
    unresolved: number;
    decisions: number;
    blockers: number;
    questions: number;
    negativeResults: number;
  };
}

export interface DomainEvent<T = unknown> {
  id: string;
  sequence: number;
  type: string;
  actor: Actor;
  authority?: DelegatedAuthority | undefined;
  missionId: string;
  entityType: "MISSION" | "PLAN" | "TASK" | "CLAIM" | "CONTRIBUTION" | "REVIEW" | "HUMAN_REQUEST" | "REPOSITORY" | "DELEGATION" | "PUBLICATION" | "BOARD_ENTRY" | "DECISION_GATE" | "DECISION_PROPOSAL" | "DECISION_BALLOT" | "MISSION_AGENT_INTEREST";
  entityId: string;
  occurredAt: string;
  payload: T;
}
