import type { Actor, AgentWorkBrief, Mission } from "@spark/contracts";
import type { MemoryStore } from "./store.js";

export function buildAgentWorkBrief(store: MemoryStore, mission: Mission, actor: Actor, after?: string): AgentWorkBrief {
  const tasks = [...store.tasks.values()].filter(task => task.missionId === mission.id);
  const taskById = new Map(tasks.map(task => [task.id, task]));
  const timestamp = Date.now();
  const claims = [...store.claims.values()].filter(claim => taskById.has(claim.taskId)
    && claim.status === "ACTIVE" && (!claim.expiresAt || Date.parse(claim.expiresAt) > timestamp));
  const reviewed = new Set([...store.reviews.values()].filter(review => review.reviewer.id === actor.id).map(review => review.contributionId));
  const pendingReviews = [...store.contributions.values()]
    .filter(item => taskById.has(item.taskId) && ["SUBMITTED", "REVIEWING"].includes(item.status)
      && item.author.id !== actor.id && !reviewed.has(item.id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(item => ({ contributionId: item.id, taskId: item.taskId, taskKey: taskById.get(item.taskId)!.key, summary: item.summary.slice(0, 240), author: item.author }));
  const availableTasks = tasks.filter(task => (task.status === "OPEN" || (task.mode === "COMPETITIVE" && task.status === "CLAIMED"))
    && (task.dependsOn ?? []).every(id => taskById.get(id)?.status === "VERIFIED")
    && !claims.some(claim => claim.taskId === task.id && (task.mode === "EXCLUSIVE" || claim.agent.id === actor.id)))
    .map(task => ({ taskId: task.id, key: task.key, title: task.title.slice(0, 160), mode: task.mode }));
  const myClaims = claims.filter(claim => claim.agent.id === actor.id)
    .map(claim => ({ claimId: claim.id, taskId: claim.taskId, taskKey: taskById.get(claim.taskId)!.key, expiresAt: claim.expiresAt }));
  const blockers: AgentWorkBrief["blockers"] = [
    ...tasks.filter(task => task.status === "BLOCKED").map(task => ({ kind: "TASK" as const, id: task.id, summary: task.title.slice(0, 200) })),
    ...[...store.humanRequests.values()].filter(request => request.missionId === mission.id && request.status === "OPEN" && request.blocking)
      .map(request => ({ kind: "HUMAN_REQUEST" as const, id: request.id, summary: request.question.slice(0, 200) })),
  ];
  const planning = [...store.decisionGates.values()].filter(gate => gate.missionId === mission.id && ["PROPOSING", "REVIEWING", "AWAITING_HUMAN"].includes(gate.status))
    .map(gate => ({ gateId: gate.id, title: gate.title.slice(0, 160), status: gate.status, requiredApprovals: gate.requiredApprovals }));
  const recentChanges = store.eventsForMission(mission.id).filter(event => !after || event.occurredAt > after)
    .sort((a, b) => b.sequence - a.sequence)
    .map(event => ({ eventId: event.id, type: event.type, entityId: event.entityId, at: event.occurredAt, actor: event.actor }));
  return {
    mission: { id: mission.id, title: mission.title, status: mission.status }, goal: mission.description.slice(0, 600), generatedAt: new Date(timestamp).toISOString(),
    nextAction: mission.status === "COMPLETED" ? "COMPLETE" : mission.status === "ABANDONED" ? "ABANDONED"
      : pendingReviews.length ? "REVIEW" : myClaims.length ? "RESUME" : availableTasks.length ? "CLAIM"
      : planning.length ? "PLAN" : blockers.length ? "UNBLOCK"
      : tasks.every(task => ["VERIFIED", "CANCELLED"].includes(task.status)) ? "PLAN" : "WAIT",
    pendingReviews: pendingReviews.slice(0, 5), availableTasks: availableTasks.slice(0, 8), myClaims: myClaims.slice(0, 8),
    blockers: blockers.slice(0, 5), planning: planning.slice(0, 5), recentChanges: recentChanges.slice(0, 8),
    totals: { pendingReviews: pendingReviews.length, availableTasks: availableTasks.length, myClaims: myClaims.length, blockers: blockers.length, planning: planning.length, recentChanges: recentChanges.length },
  };
}
