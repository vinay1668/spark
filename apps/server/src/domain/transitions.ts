import type {
  ContributionStatus,
  HumanRequestStatus,
  MissionStatus,
  ReviewStatus,
  TaskStatus,
} from "@spark/contracts";

const missionTransitions: Record<MissionStatus, readonly MissionStatus[]> = {
  PROPOSED: ["PLANNING", "ABANDONED"],
  PLANNING: ["AWAITING_APPROVAL", "ACTIVE", "ABANDONED"],
  AWAITING_APPROVAL: ["PLANNING", "ACTIVE", "ABANDONED"],
  ACTIVE: ["VERIFYING", "ABANDONED"],
  VERIFYING: ["ACTIVE", "COMPLETED", "ABANDONED"],
  COMPLETED: ["ACTIVE"],
  ABANDONED: [],
};

const taskTransitions: Record<TaskStatus, readonly TaskStatus[]> = {
  DRAFT: ["OPEN", "BLOCKED", "CANCELLED"],
  OPEN: ["CLAIMED", "BLOCKED", "CANCELLED"],
  CLAIMED: ["OPEN", "SUBMITTED", "BLOCKED", "CANCELLED"],
  SUBMITTED: ["VERIFYING", "OPEN", "BLOCKED", "CANCELLED"],
  VERIFYING: ["VERIFIED", "OPEN", "BLOCKED", "CANCELLED"],
  VERIFIED: ["OPEN", "BLOCKED"],
  BLOCKED: ["OPEN", "CANCELLED"],
  CANCELLED: [],
};

const contributionTransitions: Record<ContributionStatus, readonly ContributionStatus[]> = {
  SUBMITTED: ["REVIEWING"],
  REVIEWING: ["ACCEPTED", "CHANGES_REQUESTED", "REJECTED"],
  CHANGES_REQUESTED: ["REVIEWING", "REJECTED"],
  ACCEPTED: ["CHANGES_REQUESTED"],
  REJECTED: [],
};

const reviewTransitions: Record<ReviewStatus, readonly ReviewStatus[]> = {
  PENDING: ["PASSED", "FAILED"],
  PASSED: [],
  FAILED: [],
};

const humanRequestTransitions: Record<HumanRequestStatus, readonly HumanRequestStatus[]> = {
  OPEN: ["ANSWERED", "EXPIRED"],
  ANSWERED: [],
  EXPIRED: [],
};

export class InvalidTransitionError extends Error {
  constructor(entity: string, from: string, to: string) {
    super(`${entity} cannot transition from ${from} to ${to}`);
    this.name = "InvalidTransitionError";
  }
}

function assertTransition<T extends string>(
  entity: string,
  transitions: Record<T, readonly T[]>,
  from: T,
  to: T,
): void {
  if (!transitions[from].includes(to)) {
    throw new InvalidTransitionError(entity, from, to);
  }
}

export const transitions = {
  mission: (from: MissionStatus, to: MissionStatus) =>
    assertTransition("Mission", missionTransitions, from, to),
  task: (from: TaskStatus, to: TaskStatus) =>
    assertTransition("Task", taskTransitions, from, to),
  contribution: (from: ContributionStatus, to: ContributionStatus) =>
    assertTransition("Contribution", contributionTransitions, from, to),
  review: (from: ReviewStatus, to: ReviewStatus) =>
    assertTransition("Review", reviewTransitions, from, to),
  humanRequest: (from: HumanRequestStatus, to: HumanRequestStatus) =>
    assertTransition("Human request", humanRequestTransitions, from, to),
};
