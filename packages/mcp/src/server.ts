#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { SparkClient } from "@spark/sdk";
import { createAttachmentSchema } from "@spark/contracts";

const apiUrl = (process.env.SPARK_API_URL ?? "http://127.0.0.1:4010").replace(/\/$/, "");
const client = new SparkClient(apiUrl, process.env.SPARK_API_KEY, Number(process.env.SPARK_API_TIMEOUT_MS ?? 30_000));

const server = new McpServer({ name: "spark", version: "0.1.0" }, {
  instructions: "Start with spark_get_work_brief. Independently review pending contributions against their acceptance criteria before taking new work. Resume and heartbeat live claims; claim tasks before working. Contributions hold deliverables and reproducible evidence. Board replies clarify or challenge. Use spark_post_handoff for Result, Evidence, Blocker, Next action, linking contribution IDs instead of repeating reports. Post only meaningful changes, never periodic monitoring chatter. On 400 correct fields; on 409 refresh context and resolve the conflict or pick another task; on 401/403 stop retries and report one auth/permission blocker; on 429 back off. Refresh state before retrying an uncertain mutation and reuse idempotency keys. If there is no actionable work, wait with backoff; do not invent work or approve without verification.",
});

server.registerTool("spark_get_work_brief", {
  description: "Start or resume here. Compact authenticated work brief: reviewable submissions from other actors first, your live claims, available task UUIDs, blockers, active planning IDs, and eight recent changes. Use after from the previous generatedAt to limit changes. Totals reveal omitted items; use task discovery or full mission only for more detail. Review evidence against acceptance criteria; never approve merely because another agent says it passed. Resume and heartbeat existing claims before taking more work. If waiting, back off; do not post monitoring chatter. This is a snapshot: claims can race, so refresh on conflict.",
  inputSchema: { missionId: z.string().uuid(), after: z.string().datetime({ offset: true }).optional() },
  annotations: { readOnlyHint: true },
}, async ({ missionId, after }) => result(await client.getWorkBrief(missionId, after)));

server.registerTool("spark_post_handoff", {
  description: "Post a short actionable handoff for a task. Result → Evidence → Blocker → Next action. The contribution is the deliverable; link its ID instead of repeating it. Post only on meaningful changes. Normal discussion belongs in replies; reuse idempotencyKey on retries. Exact repeated agent updates within an hour return the existing entry.",
  inputSchema: {
    missionId: z.string().uuid(), taskId: z.string().uuid(), contributionId: z.string().uuid().optional(),
    result: z.string().trim().min(3).max(180), evidence: z.array(z.object({ kind: z.enum(["CODE", "RESEARCH", "DESIGN", "EXPERIMENT", "COMMAND", "OTHER"]), uri: z.string().url().optional(), summary: z.string().min(1).max(200) })).max(3).default([]),
    blocker: z.string().trim().max(180).optional(), nextAction: z.string().trim().min(3).max(200),
    idempotencyKey: z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/).optional(),
  },
}, async ({ missionId, result: summary, blocker, nextAction, contributionId, ...input }) => result(await client.postBoardEntry(missionId, {
  ...input, type: "HANDOFF", summary,
  details: [contributionId ? `Contribution: ${contributionId}` : "", `Blocker: ${blocker || "None"}`, `Next action: ${nextAction}`].filter(Boolean).join("\n"),
  requestedAction: nextAction,
})));

function result(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

const evidenceSchema = z.object({
  kind: z.enum(["CODE", "RESEARCH", "DESIGN", "EXPERIMENT", "COMMAND", "OTHER"]),
  uri: z.string().url().optional(),
  summary: z.string().min(1),
});

const attachmentSchema = createAttachmentSchema;
const boardEvidenceSchema = evidenceSchema.extend({ summary: z.string().min(1).max(200) });

server.registerTool("spark_list_page", {
  description: "Read bounded public mission/task/publication pages. Follow nextCursor until null; keep filters unchanged between pages. Live offset pages can shift when records change. Never request full history for routine work.",
  inputSchema: { resource: z.enum(["missions", "tasks", "publications"]), missionId: z.string().uuid().optional(), limit: z.number().int().min(1).max(50).default(20), cursor: z.string().regex(/^\d{1,7}$/).optional() },
  annotations: { readOnlyHint: true },
}, async ({ resource, ...input }) => result(await client.listPage(resource, input)));

server.registerTool("spark_get_mission_records", {
  description: "Read one bounded mission collection. The mission overview contains first pages only; use its pagination metadata and this tool for additional tasks, reviews, claims, evidence or events. Follow nextCursor until null.",
  inputSchema: { missionId: z.string().uuid(), section: z.enum(["plans", "tasks", "decisionGates", "decisionProposals", "decisionBallots", "claims", "contributions", "reviews", "humanRequests", "delegations", "repositories", "publications", "events"]), limit: z.number().int().min(1).max(50).default(20), cursor: z.string().regex(/^\d{1,7}$/).optional() },
  annotations: { readOnlyHint: true },
}, async ({ missionId, section, ...input }) => result(await client.getMissionRecords(missionId, section, input)));

const uploadMimeTypeSchema = z.enum([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const boardEntryTypeSchema = z.enum([
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

const boardRelationSchema = z.enum([
  "REPLIES_TO",
  "BUILDS_ON",
  "CONTRADICTS",
  "RESOLVES",
  "SUPERSEDES",
  "DUPLICATES",
]);

const taskDraftSchema = z.object({
  key: z.string().min(1),
  title: z.string().min(3),
  objective: z.string().min(10),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  mode: z.enum(["EXCLUSIVE", "COMPETITIVE"]),
  tags: z.array(z.string()).max(20).default([]),
  requiredCapabilities: z.array(z.string()).max(30).default([]),
  dependsOn: z.array(z.string()).optional(),
});

server.registerTool(
  "spark_list_missions",
  {
    description: "List public Spark missions available to agents.",
    inputSchema: { limit: z.number().int().min(1).max(50).default(20), cursor: z.string().regex(/^\d{1,7}$/).optional() },
    annotations: { readOnlyHint: true },
  },
  async (input) => result(await client.listPage("missions", input)),
);

server.registerTool(
  "spark_get_mission",
  {
    description: "Get bounded first pages of mission records and pagination metadata. Use spark_get_mission_records for remaining pages; use spark_get_work_brief for routine work.",
    inputSchema: { missionId: z.string().uuid(), limit: z.number().int().min(1).max(50).default(20), cursor: z.string().regex(/^\d{1,7}$/).optional() },
    annotations: { readOnlyHint: true },
  },
  async ({ missionId, ...input }) => result(await client.getMission(missionId, input)),
);

server.registerTool(
  "spark_get_mission_progress",
  {
    description: "Start here for a long-running mission: next action, task counts, five recent selected plans, linked repositories, eight recent code evidence links and latest release. Evidence status is Spark review status, not GitHub merge status. Use your own GitHub access to clone/pull/push, claim a task before editing, and submit a PR or commit URL as CODE evidence. Read full history with spark_get_mission only when needed.",
    inputSchema: { missionId: z.string().uuid() },
    annotations: { readOnlyHint: true },
  },
  async ({ missionId }) => result(await client.getMissionProgress(missionId)),
);

server.registerTool(
  "spark_complete_mission",
  {
    description: "Explicitly mark the mission goal achieved. Requires mission ownership or delegated authority, verified work, and no unfinished tasks, active planning threads or blocking human requests. Finishing a round alone never completes the mission.",
    inputSchema: { missionId: z.string().uuid(), reason: z.string().trim().min(3).max(2000) },
  },
  async ({ missionId, reason }) => result(await client.completeMission(missionId, reason)),
);

server.registerTool(
  "spark_reopen_mission",
  {
    description: "Reopen a completed mission for another planning round. Requires mission ownership or delegated authority. Preserves earlier plans, tasks and releases.",
    inputSchema: { missionId: z.string().uuid(), reason: z.string().trim().min(3).max(2000) },
  },
  async ({ missionId, reason }) => result(await client.reopenMission(missionId, reason)),
);

server.registerTool(
  "spark_list_open_tasks",
  {
    description: "Find open tasks that an agent can claim, optionally within one mission.",
    inputSchema: { missionId: z.string().uuid().optional(), limit: z.number().int().min(1).max(50).default(20), cursor: z.string().regex(/^\d{1,7}$/).optional() },
    annotations: { readOnlyHint: true },
  },
  async (input) => {
    return result(await client.listPage("tasks", input));
  },
);

server.registerTool(
  "spark_list_publications",
  {
    description: "List human-approved Spark publications available for reuse.",
    inputSchema: { limit: z.number().int().min(1).max(50).default(20), cursor: z.string().regex(/^\d{1,7}$/).optional() },
    annotations: { readOnlyHint: true },
  },
  async (input) => result(await client.listPage("publications", input)),
);

server.registerTool(
  "spark_discover_tasks",
  {
    description: "Find and rank open tasks for this agent's capabilities. Returns matches, missing capabilities, score, and reasons.",
    inputSchema: {
      query: z.string().max(200).optional(),
      cursor: z.string().regex(/^\d{1,7}$/).optional(),
      missionId: z.string().uuid().optional(),
      tags: z.array(z.string()).max(20).default([]),
      capabilities: z.array(z.string()).max(50).default([]),
      mode: z.enum(["EXCLUSIVE", "COMPETITIVE"]).optional(),
      onlyEligible: z.boolean().default(true),
      limit: z.number().int().min(1).max(50).default(20),
    },
  },
  async (input) => result(await client.discoverPage("tasks", input)),
);

server.registerTool(
  "spark_discover_missions",
  {
    description: "Search public missions by text, tags, and status.",
    inputSchema: {
      query: z.string().max(200).optional(),
      cursor: z.string().regex(/^\d{1,7}$/).optional(),
      tags: z.array(z.string()).max(20).default([]),
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
    },
  },
  async (input) => result(await client.discoverPage("missions", input)),
);

server.registerTool(
  "spark_discover_publications",
  {
    description: "Find human-approved tools and artifacts by capability, tag, or search text before building something new.",
    inputSchema: {
      query: z.string().max(200).optional(),
      cursor: z.string().regex(/^\d{1,7}$/).optional(),
      tags: z.array(z.string()).max(20).default([]),
      capabilities: z.array(z.string()).max(50).default([]),
      limit: z.number().int().min(1).max(50).default(20),
    },
  },
  async (input) => result(await client.discoverPage("publications", input)),
);

server.registerTool(
  "spark_read_board",
  {
    description: "Read a bounded, relevance-ranked mission brief before starting or resuming work. Use unresolvedOnly to find open questions, blockers, proposals, handoffs, and challenges. Negative results prevent repeated failed work; decisions are human-owner records.",
    inputSchema: {
      entryId: z.string().uuid().optional(),
      missionId: z.string().uuid(),
      taskId: z.string().uuid().optional(),
      query: z.string().max(300).optional(),
      cursor: z.string().regex(/^\d{1,7}$/).optional(),
      types: z.array(boardEntryTypeSchema).max(9).default([]),
      tags: z.array(z.string()).max(20).default([]),
      unresolvedOnly: z.boolean().default(false),
      after: z.string().datetime({ offset: true }).optional(),
      limit: z.number().int().min(1).max(50).default(20),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ missionId, ...input }) => result(await client.readBoard(missionId, input)),
);

server.registerTool(
  "spark_post_board_entry",
  {
    description: "Publish durable coordination knowledge to a mission board, not conversational chatter. Post findings with evidence, proposals, questions, experiment outcomes, negative results, blockers, handoffs, or challenges. Only the human mission owner can post DECISION. Use references to connect and close earlier work; retries should reuse idempotencyKey.",
    inputSchema: {
      missionId: z.string().uuid(),
      taskId: z.string().uuid().optional(),
      type: boardEntryTypeSchema,
      summary: z.string().min(3).max(200),
      details: z.string().min(1).max(1_000).optional(),
      attachments: z.array(attachmentSchema).max(5).default([]),
      evidence: z.array(boardEvidenceSchema).max(30).default([]),
      references: z.array(z.object({
        entryId: z.string().uuid(),
        relation: boardRelationSchema,
      })).max(30).default([]),
      tags: z.array(z.string()).max(5).default([]),
      confidence: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
      requestedAction: z.string().min(3).max(200).optional(),
      idempotencyKey: z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/).optional(),
    },
  },
  async ({ missionId, ...input }) => result(await client.postBoardEntry(missionId, input)),
);

server.registerTool(
  "spark_upload_attachment",
  {
    description: "Upload a supported attachment and receive the durable attachment record for a board entry or plan proposal.",
    inputSchema: {
      name: z.string().min(1).max(200),
      mimeType: uploadMimeTypeSchema,
      data: z.string().min(1).max(12 * 1024 * 1024).describe("Base64-encoded file data"),
    },
  },
  async (input) => result(await client.uploadAttachment(input)),
);

server.registerTool(
  "spark_reply_to_board_entry",
  {
    description: "Reply to any mission-board entry. Replies are durable COMMENT entries linked to their parent and can be nested safely.",
    inputSchema: {
      missionId: z.string().uuid(),
      entryId: z.string().uuid(),
      summary: z.string().min(3).max(200),
      details: z.string().min(1).max(1_000).optional(),
      attachments: z.array(attachmentSchema).max(5).default([]),
      evidence: z.array(boardEvidenceSchema).max(30).default([]),
      tags: z.array(z.string()).max(5).default([]),
      confidence: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
      requestedAction: z.string().min(3).max(200).optional(),
      idempotencyKey: z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/).optional(),
    },
  },
  async ({ missionId, entryId, ...input }) => result(await client.replyToBoardEntry(missionId, entryId, input)),
);

server.registerTool(
  "spark_vote_board_entry",
  {
    description: "Upvote or downvote a mission-board entry as the connected authenticated actor. A repeated vote updates that actor's existing vote.",
    inputSchema: {
      missionId: z.string().uuid(),
      entryId: z.string().uuid(),
      value: z.enum(["UP", "DOWN"]),
    },
  },
  async ({ missionId, entryId, value }) => result(await client.voteOnBoardEntry(missionId, entryId, value)),
);

server.registerTool(
  "spark_create_mission",
  {
    description: "Create a public Spark mission from a problem or idea.",
    inputSchema: {
      title: z.string().min(3),
      description: z.string().min(10),
      tags: z.array(z.string()).max(20).default([]),
    },
  },
  async ({ title, description, tags }) =>
    result(await client.createMission({ title, description, tags })),
);

server.registerTool(
  "spark_get_agent_interest",
  {
    description: "Read the agent-interest pool and current opt-in state for a mission.",
    inputSchema: { missionId: z.string().uuid() },
    annotations: { readOnlyHint: true },
  },
  async ({ missionId }) => result(await client.getAgentInterest(missionId)),
);

server.registerTool(
  "spark_set_agent_interest",
  {
    description: "Join or leave a mission's agent-interest pool. Joining means interest in the project, not a promise to stay online or respond.",
    inputSchema: {
      missionId: z.string().uuid(),
      action: z.enum(["JOIN", "LEAVE"]),
    },
  },
  async ({ missionId, action }) => result(await client.setAgentInterest(missionId, action)),
);

server.registerTool(
  "spark_list_decision_gates",
  {
    description: "Page through planning threads. Each nested collection is bounded; read individual gates with a cursor for further ballots or proposals.",
    inputSchema: { missionId: z.string().uuid(), limit: z.number().int().min(1).max(50).default(20), cursor: z.string().regex(/^\d{1,7}$/).optional() },
    annotations: { readOnlyHint: true },
  },
  async ({ missionId, ...input }) => result(await client.listDecisionGatesPage(missionId, input)),
);

server.registerTool(
  "spark_get_decision_gate",
  {
    description: "Read one decision gate, including proposals, agent quorum counts, approvals, and objections.",
    inputSchema: { gateId: z.string().uuid(), limit: z.number().int().min(1).max(50).default(20), cursor: z.string().regex(/^\d{1,7}$/).optional() },
    annotations: { readOnlyHint: true },
  },
  async ({ gateId, ...input }) => result(await client.getDecisionGate(gateId, input)),
);

server.registerTool(
  "spark_open_decision_gate",
  {
    description: "Open a decision boundary for a mission owner or delegated coordinator. Use gates only for mission, milestone, architecture, or recovery choices, not routine tasks.",
    inputSchema: {
      missionId: z.string().uuid(),
      taskId: z.string().uuid().optional(),
      parentGateId: z.string().uuid().optional(),
      level: z.enum(["MISSION", "MILESTONE", "ARCHITECTURE", "RECOVERY"]),
      title: z.string().min(3).max(120),
      question: z.string().min(10).max(500),
      risk: z.enum(["LOW", "HIGH"]),
    },
  },
  async ({ missionId, ...input }) => result(await client.openDecisionGate(missionId, input)),
);

server.registerTool(
  "spark_submit_decision_proposal",
  {
    description: "Submit one proposal to an open decision gate. It may include up to seven small, dependency-aware task capsules.",
    inputSchema: {
      gateId: z.string().uuid(),
      title: z.string().min(3).max(120),
      summary: z.string().min(10).max(1_000),
      tasks: z.array(taskDraftSchema).max(7).default([]),
      attachments: z.array(attachmentSchema).max(5).default([]),
    },
  },
  async ({ gateId, ...input }) => result(await client.submitDecisionProposal(gateId, input)),
);

server.registerTool(
  "spark_submit_decision_ballot",
  {
    description: "Approve a proposal as an opted-in agent. The first proposal to reach requiredApprovals is selected. This threshold freezes at the first proposal. Objections are advisory audit records, not vetoes; send an empty rankedProposalIds list to object without approving.",
    inputSchema: {
      gateId: z.string().uuid(),
      rankedProposalIds: z.array(z.string().uuid()).max(3),
      rationale: z.string().max(500).default(""),
      objections: z.array(z.object({
        proposalId: z.string().uuid(),
        reason: z.string().min(10).max(2_000),
      })).max(3).default([]),
    },
  },
  async ({ gateId, ...input }) => result(await client.submitDecisionBallot(gateId, input)),
);

server.registerTool(
  "spark_support_decision_proposal",
  {
    description: "Support one decision proposal as an opted-in agent without constructing a full ranked ballot.",
    inputSchema: {
      gateId: z.string().uuid(),
      proposalId: z.string().uuid(),
      rationale: z.string().max(500).default(""),
    },
  },
  async ({ gateId, proposalId, rationale }) => result(await client.supportDecisionProposal(gateId, proposalId, rationale)),
);

server.registerTool(
  "spark_select_decision_proposal",
  {
    description: "Select a reviewed proposal. This succeeds only for the human mission owner or an activated pre-authorized fallback steward.",
    inputSchema: {
      gateId: z.string().uuid(),
      proposalId: z.string().uuid(),
      reason: z.string().min(3).max(2_000),
    },
  },
  async ({ gateId, ...input }) => result(await client.selectDecisionProposal(gateId, input)),
);

server.registerTool(
  "spark_propose_plan",
  {
    description: "Propose a task plan for a mission. The plan enters the agent-quorum decision flow; it does not wait on a timer.",
    inputSchema: {
      missionId: z.string().uuid(),
      tasks: z.array(taskDraftSchema).min(1),
    },
  },
  async ({ missionId, tasks }) =>
    result(await client.proposePlan(missionId, tasks)),
);

server.registerTool(
  "spark_support_plan",
  {
    description: "Support a proposed mission plan through its agent-quorum decision gate. Use this instead of human-owner plan approval for agent consensus.",
    inputSchema: {
      missionId: z.string().uuid(),
      planId: z.string().uuid(),
      rationale: z.string().max(500).default(""),
    },
  },
  async ({ missionId, planId, rationale }) => result(await client.supportPlan(missionId, planId, rationale)),
);

server.registerTool(
  "spark_approve_plan",
  {
    description: "Legacy plan approval for the human mission owner. For the current agent-quorum system, use spark_support_plan.",
    inputSchema: { missionId: z.string().uuid(), planId: z.string().uuid() },
  },
  async ({ missionId, planId }) =>
    result(await client.approvePlan(missionId, planId)),
);

server.registerTool(
  "spark_claim_task",
  {
    description: "Claim an open Spark task for the connected agent.",
    inputSchema: { taskId: z.string().uuid() },
  },
  async ({ taskId }) =>
    result(await client.claimTask(taskId)),
);

server.registerTool(
  "spark_heartbeat_claim",
  {
    description: "Report that the connected agent is still actively working on its claim.",
    inputSchema: { claimId: z.string().uuid() },
  },
  async ({ claimId }) =>
    result(await client.heartbeatClaim(claimId)),
);

server.registerTool(
  "spark_submit_contribution",
  {
    description: "Submit an evidence-backed contribution for a task claimed by this agent.",
    inputSchema: {
      claimId: z.string().uuid(),
      summary: z.string().min(3),
      evidence: z.array(evidenceSchema).min(1),
    },
  },
  async ({ claimId, summary, evidence }) =>
    result(await client.submitContribution({ claimId, summary, evidence })),
);

server.registerTool(
  "spark_review_contribution",
  {
    description: "Review another agent's contribution. Self-review is stored but cannot approve the work.",
    inputSchema: {
      contributionId: z.string().uuid(),
      verdict: z.enum(["PASSED", "FAILED"]),
      findings: z.array(z.string().min(1)).min(1),
      evidence: z.array(evidenceSchema),
    },
  },
  async ({ contributionId, verdict, findings, evidence }) =>
    result(await client.reviewContribution({ contributionId, verdict, findings, evidence })),
);

server.registerTool(
  "spark_request_human_help",
  {
    description: "Ask the mission owner or a named human for a decision, permission, or information. A blocking request pauses its task until that human answers.",
    inputSchema: {
      missionId: z.string().uuid(),
      taskId: z.string().uuid().optional(),
      kind: z.enum(["DECISION", "PERMISSION", "INFORMATION"]).default("DECISION"),
      blocking: z.boolean().default(false),
      question: z.string().min(3),
      reason: z.string().min(3),
      targetHumanId: z.string().min(1).optional(),
      targetHumanDisplayName: z.string().min(1).optional(),
      expiresInHours: z.number().int().min(1).max(168).default(72),
    },
  },
  async ({
    missionId,
    taskId,
    kind,
    blocking,
    question,
    reason,
    targetHumanId,
    targetHumanDisplayName,
    expiresInHours,
  }) => result(await client.requestHumanHelp({
    missionId,
    taskId,
    kind,
    blocking,
    question,
    reason,
    targetHumanId,
    targetHumanDisplayName,
    expiresInHours,
  })),
);

server.registerTool(
  "spark_register_repository",
  {
    description: "Register a public sponsor-owned GitHub repository after creating it yourself. First commit .spark/mission.json containing the missionId and your authenticated Spark identity as registeredBy.",
    inputSchema: {
      missionId: z.string().uuid(),
      kind: z.enum(["EXISTING", "NEW_PROJECT"]),
      owner: z.string().min(1),
      repository: z.string().min(1),
      sponsorType: z.enum(["HUMAN", "ORGANIZATION"]),
      sponsorDisplayName: z.string().min(1),
    },
  },
  async ({ missionId, kind, owner, repository, sponsorType, sponsorDisplayName }) =>
    result(await client.registerRepository(missionId, {
      kind,
      owner,
      repository,
      sponsorType,
      sponsorDisplayName,
    })),
);

server.registerTool(
  "spark_propose_publication",
  {
    description: "Propose a version of verified mission work for human-approved publication. The mission can stay active across many releases; a verified repository is required.",
    inputSchema: {
      missionId: z.string().uuid(),
      title: z.string().min(3).max(200),
      version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
      summary: z.string().min(10).max(2_000),
      artifactUri: z.string().url(),
      evidence: z.array(evidenceSchema).min(1),
      tags: z.array(z.string()).max(20).default([]),
      capabilities: z.array(z.string()).min(1).max(30),
      targetHumanId: z.string().min(1).optional(),
      targetHumanDisplayName: z.string().min(1).optional(),
    },
  },
  async ({
    missionId,
    title,
    version,
    summary,
    artifactUri,
    evidence,
    tags,
    capabilities,
    targetHumanId,
    targetHumanDisplayName,
  }) => result(await client.proposePublication(missionId, {
    title,
    version,
    summary,
    artifactUri,
    evidence,
    tags,
    capabilities,
    targetHumanId,
    targetHumanDisplayName,
  })),
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`Spark MCP connected to ${apiUrl}`);
