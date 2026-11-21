import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import {
  answerHumanRequestSchema,
  agentInterestSchema,
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
import { UploadStore } from "./uploads.js";
import { buildAgentWorkBrief } from "../domain/agent-work-brief.js";
import { boundedView, paginate, pageQuery } from "./pagination.js";

export function registerRoutes(
  app: FastifyInstance,
  engine: CoordinationEngine,
  authenticator: Authenticator,
  mutationRunner?: {
    run<T>(action: () => T): Promise<T>;
  },
  uploads?: UploadStore,
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
  app.get<{ Params: { missionId: string }; Querystring: { after?: string } }>("/v1/missions/:missionId/work-brief",
    { preHandler: requireScope("task:claim") }, async (request, reply) => {
      const after = request.query.after;
      if (after && !Number.isFinite(Date.parse(after))) return reply.code(400).send({ error: "INVALID_INPUT", message: "after must be an ISO timestamp" });
      const mission = engine.store.missions.get(request.params.missionId) ?? engine.missionView(request.params.missionId).mission;
      return buildAgentWorkBrief(engine.store, mission, actorFor(request), after ? new Date(after).toISOString() : undefined);
    });
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
  const listResponse = (items: unknown[], query: unknown) => {
    const input = pageQuery.parse(query);
    const result = paginate(items, input);
    return input.page === "true" ? result : result.items;
  };
  const gatePage = (gateId: string, input: { limit?: number | undefined; cursor?: string | undefined }, actorId?: string) => {
    const view = engine.decisionGateView(gateId);
    const ids = new Set(paginate(view.proposals, input).items.map(proposal => proposal.id));
    return { ...boundedView(view, input), ranking: view.ranking.filter(item => ids.has(item.proposal.id)), viewerBallot: actorId ? view.ballots.find(ballot => ballot.voter.id === actorId) : undefined };
  };
  app.get("/v1/missions", async (request) => listResponse(engine.listMissions(), request.query));
  app.get<{ Querystring: { missionId?: string } }>("/v1/tasks/open", async (request) => listResponse(engine.listOpenTasks(request.query.missionId), request.query));
  app.get<{ Params: { missionId: string } }>("/v1/missions/:missionId", async (request) =>
    boundedView(engine.missionView(request.params.missionId), pageQuery.parse(request.query)),
  );
  app.get<{ Params: { missionId: string } }>("/v1/missions/:missionId/decision-gates", async (request) => {
    const actorId = (await authenticator.authenticate(request.headers.authorization))?.actor.id;
    const input = pageQuery.parse(request.query);
    const gates = [...engine.store.decisionGates.values()].filter(gate => gate.missionId === request.params.missionId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
    if (!engine.store.missions.has(request.params.missionId)) engine.missionView(request.params.missionId);
    const page = paginate(gates, input);
    const items = page.items.map(gate => gatePage(gate.id, { limit: 20 }, actorId));
    return input.page === "true" ? { ...page, items } : items;
  });
  app.get<{ Params: { missionId: string } }>("/v1/missions/:missionId/agent-interest", async (request) => {
    const context = await authenticator.authenticate(request.headers.authorization);
    return {
      ...engine.agentInterestView(request.params.missionId, context?.actor.id),
      actorType: context?.actor.type ?? null,
    };
  });
  app.get<{ Params: { gateId: string } }>("/v1/decision-gates/:gateId", async (request) => {
    const actorId = (await authenticator.authenticate(request.headers.authorization))?.actor.id;
    return gatePage(request.params.gateId, pageQuery.parse(request.query), actorId);
  });
  app.get<{ Params: { missionId: string } }>("/v1/missions/:missionId/progress", async (request) =>
    engine.missionProgress(request.params.missionId),
  );
  for (const action of ["complete", "reopen"] as const) {
    app.post<{ Params: { missionId: string } }>(`/v1/missions/:missionId/${action}`,
      { preHandler: requireScope("mission:control") }, async (request) => {
        const input = humanControlSchema.parse(request.body);
        const command = { missionId: request.params.missionId, actor: actorFor(request), reason: input.reason };
        return mutate(() => action === "complete" ? engine.completeMission(command) : engine.reopenMission(command));
      });
  }
  app.get("/v1/publications", async (request) => listResponse(engine.listPublications(), request.query));
  app.get<{ Params: { missionId: string; section: string } }>("/v1/missions/:missionId/records/:section", async (request, reply) => {
    const view = engine.missionView(request.params.missionId);
    const collection = view[request.params.section as keyof typeof view];
    if (!Array.isArray(collection)) return reply.code(400).send({ error: "INVALID_SECTION" });
    return paginate<unknown>(collection, pageQuery.parse(request.query));
  });
  const discoveryResponse = <T>(input: { limit: number; cursor?: string | undefined; page?: boolean | undefined }, read: (limit: number) => T[]) => {
    const results = read(input.limit + 1);
    return input.page ? { items: results.slice(0, input.limit), nextCursor: results.length > input.limit ? String(Number(input.cursor ?? 0) + input.limit) : null } : results.slice(0, input.limit);
  };
  app.post("/v1/discovery/tasks", async (request) =>
    (() => { const input = discoverTasksSchema.parse(request.body); return discoveryResponse(input, limit => engine.discoverTasks({ ...input, limit })); })(),
  );
  app.post("/v1/discovery/missions", async (request) =>
    (() => { const input = discoverMissionsSchema.parse(request.body); return discoveryResponse(input, limit => engine.discoverMissions({ ...input, limit })); })(),
  );
  app.post("/v1/discovery/publications", async (request) =>
    (() => { const input = discoverPublicationsSchema.parse(request.body); return discoveryResponse(input, limit => engine.discoverPublications({ ...input, limit })); })(),
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
        attachments: input.attachments,
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
    "/v1/missions/:missionId/agent-interest",
    { preHandler: requireScope("decision:vote") },
    async (request) => {
      const input = agentInterestSchema.parse(request.body);
      return mutate(() => engine.setAgentInterest(request.params.missionId, actorFor(request), input.action));
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
      const { guestId: _guestId, guestDisplayName: _guestDisplayName, ...proposalInput } = input;
      return reply.code(201).send(await mutate(() => engine.submitDecisionProposal({
        gateId: request.params.gateId,
        proposedBy,
        ...proposalInput,
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

  app.post<{ Body: { name: string; mimeType: string; data: string } }>(
    "/v1/uploads",
    { preHandler: requireScope("board:write"), bodyLimit: 12 * 1024 * 1024 },
    async (request, reply) => {
      if (!uploads) return reply.code(503).send({ error: "UPLOADS_UNAVAILABLE" });
      try {
        const attachment = await uploads.store({
          name: request.body.name,
          mimeType: request.body.mimeType,
          data: request.body.data,
          actor: actorFor(request),
        });
        return reply.code(201).send(attachment);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Upload failed";
        return reply.code(400).send({ error: "INVALID_UPLOAD", message });
      }
    },
  );

  app.post<{ Body: { guestId: string; guestDisplayName: string; name: string; mimeType: string; data: string } }>(
    "/v1/guest/uploads",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } }, bodyLimit: 12 * 1024 * 1024 },
    async (request, reply) => {
      if (!uploads) return reply.code(503).send({ error: "UPLOADS_UNAVAILABLE" });
      try {
        const { guestId, guestDisplayName, name, mimeType, data } = request.body;
        const actor: Actor = { id: `guest:${guestId}`, type: "human", displayName: guestDisplayName };
        const attachment = await uploads.store({ name, mimeType, data, actor });
        return reply.code(201).send(attachment);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Upload failed";
        return reply.code(400).send({ error: "INVALID_UPLOAD", message });
      }
    },
  );

  app.get<{ Params: { uploadId: string } }>(
    "/uploads/:uploadId",
    async (request, reply) => {
      if (!uploads) return reply.code(503).send({ error: "UPLOADS_UNAVAILABLE" });
      const file = await uploads.fetch(request.params.uploadId);
      if (!file) return reply.code(404).send({ error: "NOT_FOUND" });
      return reply
        .type(file.mimeType)
        .header("x-content-type-options", "nosniff")
        .header("content-security-policy", "sandbox; default-src 'none'")
        .header("content-disposition", `attachment; filename="${file.filename.replace(/[^a-zA-Z0-9._ -]/g, "_")}"`)
        .send(file.data);
    },
  );
}
