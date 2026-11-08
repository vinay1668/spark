import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import {
  answerHumanRequestSchema,
  boardVoteSchema,
  approveGuestPlanSchema,
  approvePlanSchema,
  createBoardEntrySchema,
  createDecisionGateSchema,
  claimTaskSchema,
  contributionSchema,
  createGuestBoardEntrySchema,
  createGuestDecisionGateSchema,
  createGuestMissionSchema,
  createMissionSchema,
  decidePublicationSchema,
  discoverMissionsSchema,
  discoverPublicationsSchema,
  discoverTasksSchema,
  heartbeatSchema,
  humanControlSchema,
  humanRequestSchema,
  grantDelegationSchema,
  registerRepositorySchema,
  rejectPlanSchema,
  revokeDelegationSchema,
  selectDecisionProposalSchema,
  selectGuestDecisionProposalSchema,
  submitDecisionBallotSchema,
  submitGuestDecisionBallotSchema,
  submitDecisionProposalSchema,
  submitGuestDecisionProposalSchema,
  proposePlanSchema,
  proposeGuestPlanSchema,
  proposePublicationSchema,
  queryMissionBoardSchema,
  reviewSchema,
  withdrawPublicationSchema,
} from "@spark/contracts";
import type { Actor } from "@spark/contracts";
import type { ApiScope, Authenticator } from "../auth/authenticator.js";
import { CoordinationEngine, DomainError } from "../domain/engine.js";
import {
  RepositoryVerificationError,
  verifyPublicGitHubRepository,
} from "../repositories/github-verifier.js";

export function registerRoutes(
  app: FastifyInstance,
  engine: CoordinationEngine,
  authenticator: Authenticator,
  mutationRunner?: {
    run<T>(action: () => T): Promise<T>;
  },
): void {
  const actors = new WeakMap<FastifyRequest, Actor>();

  function requireScope(scope: ApiScope) {
    return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const context = await authenticator.authenticate(request.headers.authorization);
      if (!context) {
        await reply.code(401).header("WWW-Authenticate", "Bearer").send({ error: "UNAUTHENTICATED" });
        return;
      }
      if (!context.scopes.has(scope)) {
        await reply.code(403).send({ error: "INSUFFICIENT_SCOPE", requiredScope: scope });
        return;
      }
      actors.set(request, context.actor);
    };
  }

  function actorFor(request: FastifyRequest): Actor {
    const actor = actors.get(request);
    if (!actor) throw new Error("Authenticated actor is unavailable");
    return actor;
  }

  async function mutate<T>(action: () => T): Promise<T> {
    return mutationRunner ? mutationRunner.run(action) : action();
  }

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "INVALID_INPUT", issues: error.issues });
    }
    if (error instanceof DomainError) {
      return reply.code(409).send({ error: "DOMAIN_RULE_VIOLATION", message: error.message });
    }
    if (error instanceof RepositoryVerificationError) {
      app.log.warn({ status: error.status }, "Public repository verification failed");
      return reply.code(422).send({ error: "REPOSITORY_VERIFICATION_FAILED", message: error.message });
    }
    app.log.error(error);
    return reply.code(500).send({ error: "INTERNAL_ERROR" });
  });

  app.get("/health", async () => ({ status: "ok" }));
  app.post<{ Body: { displayName?: string } }>(
    "/v1/identity/display-name",
    { preHandler: requireScope("mission:create") },
    async (request, reply) => {
      const displayName = String(request.body?.displayName ?? "").trim();
      if (!/^[A-Za-z][A-Za-z0-9_]{2,31}$/.test(displayName)) {
        return reply.code(400).send({ error: "INVALID_DISPLAY_NAME" });
      }
      if (!authenticator.reserveDisplayName) {
        return reply.code(503).send({ error: "DISPLAY_NAME_RESERVATION_UNAVAILABLE" });
      }
      const reserved = await authenticator.reserveDisplayName(actorFor(request).id, displayName);
      return reserved ? { displayName } : reply.code(409).send({ error: "DISPLAY_NAME_TAKEN" });
    },
  );
  app.get("/v1/missions", async () => engine.listMissions());
  app.get<{ Querystring: { missionId?: string } }>("/v1/tasks/open", async (request) =>
    engine.listOpenTasks(request.query.missionId),
  );
  app.get<{ Params: { missionId: string } }>("/v1/missions/:missionId", async (request) =>
    engine.missionView(request.params.missionId),
  );
  app.get<{ Params: { missionId: string } }>("/v1/missions/:missionId/decision-gates", async (request) =>
    engine.listDecisionGates(request.params.missionId),
  );
  app.get<{ Params: { gateId: string } }>("/v1/decision-gates/:gateId", async (request) =>
    engine.decisionGateView(request.params.gateId),
  );
  app.get("/v1/publications", async () => engine.listPublications());
  app.post("/v1/discovery/tasks", async (request) =>
    engine.discoverTasks(discoverTasksSchema.parse(request.body)),
  );
  app.post("/v1/discovery/missions", async (request) =>
    engine.discoverMissions(discoverMissionsSchema.parse(request.body)),
  );
  app.post("/v1/discovery/publications", async (request) =>
    engine.discoverPublications(discoverPublicationsSchema.parse(request.body)),
  );
  app.post<{ Params: { missionId: string } }>(
    "/v1/missions/:missionId/board/query",
    async (request) => engine.queryMissionBoard({
      missionId: request.params.missionId,
      viewerId: (await authenticator.authenticate(request.headers.authorization))?.actor.id,
      ...queryMissionBoardSchema.parse(request.body),
    }),
  );

  app.post<{ Params: { missionId: string; entryId: string } }>(
    "/v1/missions/:missionId/board/:entryId/vote",
    { preHandler: requireScope("board:vote") },
    async (request, reply) => reply.code(200).send(await mutate(() => engine.voteOnBoardEntry({
      missionId: request.params.missionId,
      entryId: request.params.entryId,
      voter: actorFor(request),
      ...boardVoteSchema.parse(request.body),
    }))),
  );

  app.post<{ Params: { missionId: string } }>(
    "/v1/guest/missions/:missionId/board",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const input = createGuestBoardEntrySchema.parse(request.body);
      const author: Actor = {
        id: `guest:${input.guestId}`,
        type: "human",
        displayName: input.guestDisplayName,
      };
      return reply.code(201).send(await mutate(() => engine.postBoardEntry({
        missionId: request.params.missionId,
        taskId: input.taskId,
        type: input.type,
        author,
        summary: input.summary,
        details: input.details,
        evidence: input.evidence,
        references: input.references,
        tags: input.tags,
        confidence: input.confidence,
        requestedAction: input.requestedAction,
        idempotencyKey: input.idempotencyKey,
      })));
    },
  );

  app.post<{ Params: { missionId: string } }>(
    "/v1/missions/:missionId/board",
    { preHandler: requireScope("board:write") },
    async (request, reply) => {
      const input = createBoardEntrySchema.parse(request.body);
      return reply.code(201).send(await mutate(() => engine.postBoardEntry({
        missionId: request.params.missionId,
        author: actorFor(request),
        ...input,
      })));
    },
  );

  app.post(
    "/v1/guest/missions",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const input = createGuestMissionSchema.parse(request.body);
      const creator: Actor = {
        id: `guest:${input.guestId}`,
        type: "human",
        displayName: input.guestDisplayName,
      };
      return reply.code(201).send(await mutate(() => engine.createMission({
        title: input.title,
        description: input.description,
        tags: input.tags,
        creator,
      })));
    },
  );

  app.post(
    "/v1/missions",
    { preHandler: requireScope("mission:create") },
    async (request, reply) => {
      const input = createMissionSchema.parse(request.body);
      return reply.code(201).send(
        await mutate(() => engine.createMission({ ...input, creator: actorFor(request) })),
      );
    },
  );

  app.post<{ Params: { missionId: string } }>(
    "/v1/missions/:missionId/decision-gates",
    { preHandler: requireScope("decision:create") },
    async (request, reply) => {
      const input = createDecisionGateSchema.parse(request.body);
      return reply.code(201).send(await mutate(() => engine.openDecisionGate({
        missionId: request.params.missionId,
        actor: actorFor(request),
        ...input,
      })));
    },
  );

  app.post<{ Params: { missionId: string } }>(
    "/v1/guest/missions/:missionId/decision-gates",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const input = createGuestDecisionGateSchema.parse(request.body);
      const actor: Actor = { id: `guest:${input.guestId}`, type: "human", displayName: input.guestDisplayName };
      const { guestId: _guestId, guestDisplayName: _guestDisplayName, ...gateInput } = input;
      return reply.code(201).send(await mutate(() => engine.openDecisionGate({
        missionId: request.params.missionId,
        actor,
        ...gateInput,
      })));
    },
  );

  app.post<{ Params: { gateId: string } }>(
    "/v1/decision-gates/:gateId/proposals",
    { preHandler: requireScope("decision:propose") },
    async (request, reply) => {
      const input = submitDecisionProposalSchema.parse(request.body);
      return reply.code(201).send(await mutate(() => engine.submitDecisionProposal({
        gateId: request.params.gateId,
        proposedBy: actorFor(request),
        ...input,
      })));
    },
  );

  app.post<{ Params: { gateId: string } }>(
    "/v1/guest/decision-gates/:gateId/proposals",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const input = submitGuestDecisionProposalSchema.parse(request.body);
      const proposedBy: Actor = { id: `guest:${input.guestId}`, type: "human", displayName: input.guestDisplayName };
      return reply.code(201).send(await mutate(() => engine.submitDecisionProposal({
        gateId: request.params.gateId,
        proposedBy,
        title: input.title,
        summary: input.summary,
        tasks: input.tasks,
      })));
    },
  );

  app.post<{ Params: { gateId: string } }>(
    "/v1/decision-gates/:gateId/ballots",
    { preHandler: requireScope("decision:vote") },
    async (request, reply) => {
      const input = submitDecisionBallotSchema.parse(request.body);
      return reply.code(201).send(await mutate(() => engine.submitDecisionBallot({
        gateId: request.params.gateId,
        voter: actorFor(request),
        ...input,
      })));
    },
  );

  app.post<{ Params: { gateId: string } }>(
    "/v1/guest/decision-gates/:gateId/ballots",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const input = submitGuestDecisionBallotSchema.parse(request.body);
      const voter: Actor = { id: `guest:${input.guestId}`, type: "human", displayName: input.guestDisplayName };
      return reply.code(201).send(await mutate(() => engine.submitDecisionBallot({
        gateId: request.params.gateId,
        voter,
        rankedProposalIds: input.rankedProposalIds,
        rationale: input.rationale,
        objections: input.objections,
      })));
    },
  );

  app.post<{ Params: { gateId: string } }>(
    "/v1/decision-gates/:gateId/select",
    { preHandler: requireScope("decision:select") },
    async (request) => {
      const input = selectDecisionProposalSchema.parse(request.body);
      return mutate(() => engine.selectDecisionProposal({
        gateId: request.params.gateId,
        selectedBy: actorFor(request),
        ...input,
      }));
    },
  );

  app.post<{ Params: { gateId: string } }>(
    "/v1/guest/decision-gates/:gateId/select",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request) => {
      const input = selectGuestDecisionProposalSchema.parse(request.body);
      const selectedBy: Actor = { id: `guest:${input.guestId}`, type: "human", displayName: input.guestDisplayName };
      return mutate(() => engine.selectDecisionProposal({
        gateId: request.params.gateId,
        selectedBy,
        proposalId: input.proposalId,
        reason: input.reason,
      }));
    },
  );

  app.post<{ Params: { missionId: string } }>(
    "/v1/missions/:missionId/delegations",
    { preHandler: requireScope("delegation:manage") },
    async (request, reply) => {
      const input = grantDelegationSchema.parse(request.body);
      return reply.code(201).send(await mutate(() => engine.grantDelegation({
        missionId: request.params.missionId,
        grantedBy: actorFor(request),
        ...input,
      })));
    },
  );

  app.post<{ Params: { missionId: string; delegationId: string } }>(
    "/v1/missions/:missionId/delegations/:delegationId/revoke",
    { preHandler: requireScope("delegation:manage") },
    async (request) => {
      revokeDelegationSchema.parse(request.body);
      return mutate(() => engine.revokeDelegation({
        missionId: request.params.missionId,
        delegationId: request.params.delegationId,
        revokedBy: actorFor(request),
      }));
    },
  );

  app.post<{ Params: { missionId: string } }>(
    "/v1/missions/:missionId/publications",
    { preHandler: requireScope("publication:propose") },
    async (request, reply) => {
      const input = proposePublicationSchema.parse(request.body);
      return reply.code(201).send(await mutate(() => engine.proposePublication({
        missionId: request.params.missionId,
        proposedBy: actorFor(request),
        ...input,
      })));
    },
  );

  app.post<{ Params: { publicationId: string } }>(
    "/v1/publications/:publicationId/decision",
    { preHandler: requireScope("publication:decide") },
    async (request) => {
      const input = decidePublicationSchema.parse(request.body);
      return mutate(() => engine.decidePublication({
        publicationId: request.params.publicationId,
        decidedBy: actorFor(request),
        ...input,
      }));
    },
  );

  app.post<{ Params: { publicationId: string } }>(
    "/v1/publications/:publicationId/withdraw",
    { preHandler: requireScope("publication:withdraw") },
    async (request) => {
      const input = withdrawPublicationSchema.parse(request.body);
      return mutate(() => engine.withdrawPublication({
        publicationId: request.params.publicationId,
        withdrawnBy: actorFor(request),
        reason: input.reason,
      }));
    },
  );

  app.post<{ Params: { missionId: string } }>(
    "/v1/guest/missions/:missionId/plans",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const input = proposeGuestPlanSchema.parse(request.body);
      const proposedBy: Actor = {
        id: `guest:${input.guestId}`,
        type: "human",
        displayName: input.guestDisplayName,
      };
      return reply.code(201).send(await mutate(() => engine.proposePlan(
        request.params.missionId,
        proposedBy,
        input.tasks,
      )));
    },
  );

  app.post<{ Params: { missionId: string } }>(
    "/v1/guest/missions/:missionId/plans/approve",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request) => {
      const input = approveGuestPlanSchema.parse(request.body);
      const approvedBy: Actor = {
        id: `guest:${input.guestId}`,
        type: "human",
        displayName: input.guestDisplayName,
      };
      return mutate(() => engine.approvePlan(request.params.missionId, input.planId, approvedBy));
    },
  );

  app.post<{ Params: { missionId: string } }>(
    "/v1/missions/:missionId/plans",
    { preHandler: requireScope("plan:propose") },
    async (request, reply) => {
      const input = proposePlanSchema.parse(request.body);
      return reply.code(201).send(
        await mutate(() => engine.proposePlan(request.params.missionId, actorFor(request), input.tasks)),
      );
    },
  );

  app.post<{ Params: { missionId: string } }>(
    "/v1/missions/:missionId/plans/approve",
    { preHandler: requireScope("plan:approve") },
    async (request) => {
      const input = approvePlanSchema.parse(request.body);
      return mutate(() => engine.approvePlan(request.params.missionId, input.planId, actorFor(request)));
    },
  );

  app.post<{ Params: { missionId: string } }>(
    "/v1/missions/:missionId/plans/reject",
    { preHandler: requireScope("plan:reject") },
    async (request) => {
      const input = rejectPlanSchema.parse(request.body);
      return mutate(() => engine.rejectPlan({
        missionId: request.params.missionId,
        planId: input.planId,
        rejectedBy: actorFor(request),
        reason: input.reason,
      }));
    },
  );

  app.post<{ Params: { missionId: string } }>(
    "/v1/missions/:missionId/abandon",
    { preHandler: requireScope("mission:control") },
    async (request) => {
      const input = humanControlSchema.parse(request.body);
      return mutate(() => engine.abandonMission({
        missionId: request.params.missionId,
        abandonedBy: actorFor(request),
        reason: input.reason,
      }));
    },
  );

  app.post<{ Params: { taskId: string } }>(
    "/v1/tasks/:taskId/cancel",
    { preHandler: requireScope("task:control") },
    async (request) => {
      const input = humanControlSchema.parse(request.body);
      return mutate(() => engine.cancelTask({
        taskId: request.params.taskId,
        cancelledBy: actorFor(request),
        reason: input.reason,
      }));
    },
  );

  app.post<{ Params: { taskId: string } }>(
    "/v1/tasks/:taskId/reopen",
    { preHandler: requireScope("task:control") },
    async (request) => {
      const input = humanControlSchema.parse(request.body);
      return mutate(() => engine.reopenTask({
        taskId: request.params.taskId,
        reopenedBy: actorFor(request),
        reason: input.reason,
      }));
    },
  );

  app.post<{ Params: { taskId: string } }>(
    "/v1/tasks/:taskId/claims",
    { preHandler: requireScope("task:claim") },
    async (request, reply) => {
      claimTaskSchema.parse(request.body);
      return reply.code(201).send(
        await mutate(() => engine.claimTask(request.params.taskId, actorFor(request))),
      );
    },
  );

  app.post<{ Params: { claimId: string } }>(
    "/v1/claims/:claimId/heartbeat",
    { preHandler: requireScope("task:claim") },
    async (request) => {
      heartbeatSchema.parse(request.body);
      return mutate(() => engine.heartbeatClaim(request.params.claimId, actorFor(request)));
    },
  );

  app.post(
    "/v1/contributions",
    { preHandler: requireScope("contribution:submit") },
    async (request, reply) => {
      const input = contributionSchema.parse(request.body);
      return reply.code(201).send(
        await mutate(() => engine.submitContribution({ ...input, author: actorFor(request) })),
      );
    },
  );

  app.post<{ Params: { contributionId: string } }>(
    "/v1/contributions/:contributionId/reviews",
    { preHandler: requireScope("review:submit") },
    async (request, reply) => {
      const input = reviewSchema.parse(request.body);
      return reply.code(201).send(
        await mutate(() => engine.reviewContribution({
          contributionId: request.params.contributionId,
          reviewer: actorFor(request),
          ...input,
        })),
      );
    },
  );

  app.post(
    "/v1/human-requests",
    { preHandler: requireScope("human_request:create") },
    async (request, reply) => {
      const input = humanRequestSchema.parse(request.body);
      return reply.code(201).send(
        await mutate(() => engine.createHumanRequest({ ...input, requestedBy: actorFor(request) })),
      );
    },
  );

  app.post<{ Params: { requestId: string } }>(
    "/v1/human-requests/:requestId/answer",
    { preHandler: requireScope("human_request:answer") },
    async (request) => {
      const input = answerHumanRequestSchema.parse(request.body);
      return mutate(() => engine.answerHumanRequest(request.params.requestId, actorFor(request), input.answer));
    },
  );

  app.post<{ Params: { missionId: string } }>(
    "/v1/missions/:missionId/repository",
    { preHandler: requireScope("repository:register") },
    async (request, reply) => {
      const input = registerRepositorySchema.parse(request.body);
      const actor = actorFor(request);
      const repository = await verifyPublicGitHubRepository({
        owner: input.owner,
        repository: input.repository,
        missionId: request.params.missionId,
        registeredBy: actor.id,
        expectedOwnerType: input.sponsorType,
      });
      return reply.code(201).send(await mutate(() => engine.registerRepository({
        missionId: request.params.missionId,
        actor,
        kind: input.kind,
        sponsorType: input.sponsorType,
        sponsorDisplayName: input.sponsorDisplayName,
        owner: repository.owner,
        repository: repository.repository,
        githubRepositoryId: repository.githubRepositoryId,
        repositoryUrl: repository.repositoryUrl,
        defaultBranch: repository.defaultBranch,
        proofPath: repository.proofPath,
      })));
    },
  );
}
