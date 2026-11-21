import { z } from "zod";

const labelSchema = z.string().min(1).max(50).regex(/^[a-z0-9][a-z0-9._-]*$/);

export const actorSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["human", "agent", "system"]),
  displayName: z.string().min(1),
});

export const evidenceSchema = z.object({
  kind: z.enum(["CODE", "RESEARCH", "DESIGN", "EXPERIMENT", "COMMAND", "OTHER"]),
  uri: z.url().optional(),
  summary: z.string().min(1),
});

export const attachmentSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  url: z.string().max(4_000).refine((value) => {
    if (/^\/uploads\/[0-9a-f-]{36}$/i.test(value)) return true;
    try {
      return ["http:", "https:"].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  }, "Expected an HTTP(S) URL or a Spark upload path"),
  mimeType: z.string().trim().min(1).max(100),
  size: z.number().int().min(0).max(50 * 1024 * 1024).default(0),
  uploadedBy: actorSchema,
  uploadedAt: z.string().datetime(),
});

export const createAttachmentSchema = attachmentSchema;

export const createMissionSchema = z.object({
  title: z.string().min(3),
  description: z.string().min(10),
  tags: z.array(labelSchema).max(20).default([]),
});

export const createGuestMissionSchema = createMissionSchema.extend({
  guestId: z.string().uuid(),
  guestDisplayName: z.string().min(3).max(40).regex(/^[A-Za-z][A-Za-z0-9_]*$/),
});

const taskDraftSchema = z.object({
  key: z.string().min(1).regex(/^[a-z0-9][a-z0-9_-]*$/),
  title: z.string().min(3),
  objective: z.string().min(10),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  mode: z.enum(["EXCLUSIVE", "COMPETITIVE"]),
  tags: z.array(labelSchema).max(20).default([]),
  requiredCapabilities: z.array(labelSchema).max(30).default([]),
  dependsOn: z.array(z.string()).optional(),
});

export const proposePlanSchema = z.object({
  tasks: z.array(taskDraftSchema).min(1),
});

const guestIdentitySchema = z.object({
  guestId: z.string().uuid(),
  guestDisplayName: z.string().min(3).max(40).regex(/^[A-Za-z][A-Za-z0-9_]*$/),
});

export const proposeGuestPlanSchema = proposePlanSchema.extend(guestIdentitySchema.shape);

export const approvePlanSchema = z.object({
  planId: z.string().uuid(),
});

export const approveGuestPlanSchema = approvePlanSchema.extend(guestIdentitySchema.shape);

export const createDecisionGateSchema = z.object({
  taskId: z.string().uuid().optional(),
  parentGateId: z.string().uuid().optional(),
  level: z.enum(["MISSION", "MILESTONE", "ARCHITECTURE", "RECOVERY"]),
  title: z.string().trim().min(3).max(200),
  question: z.string().trim().min(10).max(2_000),
  risk: z.enum(["LOW", "HIGH"]),
  proposalHours: z.number().min(0.001).max(168).default(24).optional(),
  reviewHours: z.number().min(0.001).max(168).default(24).optional(),
  ownerGraceHours: z.number().min(0.001).max(168).default(24).optional(),
  minIndependentBallots: z.number().int().min(1).max(20).default(3),
  autoSelect: z.boolean().default(true),
  fallbackHumanId: z.string().min(1).max(200).optional(),
  fallbackHumanDisplayName: z.string().min(1).max(200).optional(),
}).refine(
  (value) => Boolean(value.fallbackHumanId) === Boolean(value.fallbackHumanDisplayName),
  { message: "fallbackHumanId and fallbackHumanDisplayName must be provided together" },
);

export const submitDecisionProposalSchema = z.object({
  title: z.string().trim().min(3).max(200),
  summary: z.string().trim().min(10).max(5_000),
  tasks: z.array(taskDraftSchema).max(7).default([]),
  attachments: z.array(createAttachmentSchema).max(10).default([]),
});

export const agentInterestSchema = z.object({
  action: z.enum(["JOIN", "LEAVE"]),
});

export const submitDecisionBallotSchema = z.object({
  rankedProposalIds: z.array(z.string().uuid()).max(3)
    .refine((values) => new Set(values).size === values.length, { message: "Ranked proposals must be unique" }),
  rationale: z.string().trim().max(5_000).default(""),
  objections: z.array(z.object({
    proposalId: z.string().uuid(),
    reason: z.string().trim().min(10).max(2_000),
  })).max(3).default([]),
}).refine(
  (value) => value.rankedProposalIds.length > 0 || value.objections.length > 0,
  { message: "A ballot must rank at least one proposal or include at least one objection" },
);

export const selectDecisionProposalSchema = z.object({
  proposalId: z.string().uuid(),
  reason: z.string().trim().min(3).max(2_000),
});

export const createGuestDecisionGateSchema = createDecisionGateSchema.and(guestIdentitySchema);
export const submitGuestDecisionProposalSchema = submitDecisionProposalSchema.extend(guestIdentitySchema.shape);
export const submitGuestDecisionBallotSchema = submitDecisionBallotSchema.extend(guestIdentitySchema.shape);
export const selectGuestDecisionProposalSchema = selectDecisionProposalSchema.extend(guestIdentitySchema.shape);

export const rejectPlanSchema = z.object({
  planId: z.string().uuid(),
  reason: z.string().min(3).max(2_000),
});

export const humanControlSchema = z.object({
  reason: z.string().min(3).max(2_000),
});

export const claimTaskSchema = z.object({});
export const heartbeatSchema = z.object({});

export const contributionSchema = z.object({
  claimId: z.string().uuid(),
  summary: z.string().min(3),
  evidence: z.array(evidenceSchema).min(1),
});

export const reviewSchema = z.object({
  verdict: z.enum(["PASSED", "FAILED"]),
  findings: z.array(z.string().min(1)).min(1),
  evidence: z.array(evidenceSchema),
});

export const humanRequestSchema = z.object({
  missionId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  kind: z.enum(["DECISION", "PERMISSION", "INFORMATION"]).default("DECISION"),
  blocking: z.boolean().default(false),
  question: z.string().min(3),
  reason: z.string().min(3),
  targetHumanId: z.string().min(1).max(200).optional(),
  targetHumanDisplayName: z.string().min(1).max(200).optional(),
  expiresInHours: z.number().int().min(1).max(168).default(72),
}).refine(
  (value) => Boolean(value.targetHumanId) === Boolean(value.targetHumanDisplayName),
  { message: "targetHumanId and targetHumanDisplayName must be provided together" },
);

export const answerHumanRequestSchema = z.object({
  answer: z.string().min(1),
});

export const grantDelegationSchema = z.object({
  agentId: z.string().min(1).max(200),
  agentDisplayName: z.string().min(1).max(200),
});

export const revokeDelegationSchema = z.object({});

export const registerRepositorySchema = z.object({
  kind: z.enum(["EXISTING", "NEW_PROJECT"]),
  owner: z.string().min(1).max(100).regex(/^[A-Za-z0-9-]+$/),
  repository: z.string().min(1).max(100).regex(/^[A-Za-z0-9._-]+$/),
  sponsorType: z.enum(["HUMAN", "ORGANIZATION"]),
  sponsorDisplayName: z.string().min(1).max(200),
});

export const proposePublicationSchema = z.object({
  title: z.string().min(3).max(200),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
  summary: z.string().min(10).max(2_000),
  artifactUri: z.url(),
  evidence: z.array(evidenceSchema).min(1),
  tags: z.array(labelSchema).max(20).default([]),
  capabilities: z.array(labelSchema).min(1).max(30),
  targetHumanId: z.string().min(1).max(200).optional(),
  targetHumanDisplayName: z.string().min(1).max(200).optional(),
}).refine(
  (value) => Boolean(value.targetHumanId) === Boolean(value.targetHumanDisplayName),
  { message: "targetHumanId and targetHumanDisplayName must be provided together" },
);

export const decidePublicationSchema = z.object({
  verdict: z.enum(["PUBLISHED", "REJECTED"]),
  reason: z.string().min(3).max(2_000),
});

export const withdrawPublicationSchema = z.object({
  reason: z.string().min(3).max(2_000),
});

export const discoverTasksSchema = z.object({
  cursor: z.string().regex(/^\d{1,7}$/).optional(),
  page: z.boolean().optional(),
  query: z.string().trim().max(200).optional(),
  missionId: z.string().uuid().optional(),
  tags: z.array(labelSchema).max(20).default([]),
  capabilities: z.array(labelSchema).max(50).default([]),
  mode: z.enum(["EXCLUSIVE", "COMPETITIVE"]).optional(),
  onlyEligible: z.boolean().default(true),
  limit: z.number().int().min(1).max(50).default(20),
});

export const discoverMissionsSchema = z.object({
  cursor: z.string().regex(/^\d{1,7}$/).optional(),
  page: z.boolean().optional(),
  query: z.string().trim().max(200).optional(),
  tags: z.array(labelSchema).max(20).default([]),
  statuses: z.array(z.enum([
    "PROPOSED",
    "PLANNING",
    "AWAITING_APPROVAL",
    "ACTIVE",
    "VERIFYING",
    "COMPLETED",
    "ABANDONED",
  ])).max(7).default([]),
  limit: z.number().int().min(1).max(50).default(20),
});

export const discoverPublicationsSchema = z.object({
  cursor: z.string().regex(/^\d{1,7}$/).optional(),
  page: z.boolean().optional(),
  query: z.string().trim().max(200).optional(),
  tags: z.array(labelSchema).max(20).default([]),
  capabilities: z.array(labelSchema).max(50).default([]),
  limit: z.number().int().min(1).max(50).default(20),
});

export const boardEntryTypeSchema = z.enum([
  "COMMENT",
  "FINDING",
  "PROPOSAL",
  "QUESTION",
  "EXPERIMENT",
  "NEGATIVE_RESULT",
  "BLOCKER",
  "HANDOFF",
  "CHALLENGE",
  "DECISION",
]);

export const boardRelationTypeSchema = z.enum([
  "REPLIES_TO",
  "BUILDS_ON",
  "CONTRADICTS",
  "BLOCKS",
  "RESOLVES",
  "SUPERSEDES",
  "DUPLICATES",
]);

export const createBoardEntrySchema = z.object({
  taskId: z.string().uuid().optional(),
  type: boardEntryTypeSchema,
  summary: z.string().trim().min(3).max(500),
  details: z.string().trim().min(1).max(20_000).optional(),
  evidence: z.array(evidenceSchema).max(30).default([]),
  attachments: z.array(createAttachmentSchema).max(10).default([]),
  references: z.array(z.object({
    entryId: z.string().uuid(),
    relation: boardRelationTypeSchema,
  })).max(30).default([]),
  tags: z.array(labelSchema).max(20).default([]),
  confidence: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
  requestedAction: z.string().trim().min(3).max(1_000).optional(),
  idempotencyKey: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/).optional(),
});

export const createGuestBoardEntrySchema = createBoardEntrySchema.extend({
  guestId: z.string().uuid(),
  guestDisplayName: z.string().min(3).max(40).regex(/^[A-Za-z][A-Za-z0-9_]*$/),
});

export const queryMissionBoardSchema = z.object({
  entryId: z.string().uuid().optional(),
  cursor: z.string().regex(/^\d{1,7}$/).optional(),
  taskId: z.string().uuid().optional(),
  query: z.string().trim().max(300).optional(),
  types: z.array(boardEntryTypeSchema).max(10).default([]),
  tags: z.array(labelSchema).max(20).default([]),
  unresolvedOnly: z.boolean().default(false),
  after: z.iso.datetime({ offset: true }).optional(),
  limit: z.number().int().min(1).max(50).default(20),
});

export const boardVoteSchema = z.object({
  value: z.enum(["UP", "DOWN"]),
});
