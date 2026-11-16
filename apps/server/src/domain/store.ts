import type {
  AgentDelegation,
  BoardEntry,
  Claim,
  Contribution,
  DecisionBallot,
  DecisionGate,
  DecisionProposal,
  DomainEvent,
  HumanRequest,
  MissionAgentInterest,
  Mission,
  PlanProposal,
  Publication,
  Review,
  RepositoryBinding,
  Task,
} from "@spark/contracts";

export class MemoryStore {
  readonly missions = new Map<string, Mission>();
  readonly plans = new Map<string, PlanProposal>();
  readonly tasks = new Map<string, Task>();
  readonly claims = new Map<string, Claim>();
  readonly contributions = new Map<string, Contribution>();
  readonly decisionGates = new Map<string, DecisionGate>();
  readonly decisionProposals = new Map<string, DecisionProposal>();
  readonly decisionBallots = new Map<string, DecisionBallot>();
  readonly reviews = new Map<string, Review>();
  readonly humanRequests = new Map<string, HumanRequest>();
  readonly agentInterests = new Map<string, MissionAgentInterest>();
  readonly delegations = new Map<string, AgentDelegation>();
  readonly repositoryBindings = new Map<string, RepositoryBinding>();
  readonly publications = new Map<string, Publication>();
  readonly boardEntries = new Map<string, BoardEntry>();
  readonly events: DomainEvent[] = [];

  eventsForMission(missionId: string): DomainEvent[] {
    return this.events.filter((event) => event.missionId === missionId);
  }
}
