import type { Mission, MissionProgress, Task } from "@spark/contracts";
import type { MemoryStore } from "./store.js";

/** Derived from persisted coordination records, never inferred from GitHub activity. */
export function buildMissionProgress(store: MemoryStore, mission: Mission): MissionProgress {
  const tasks = [...store.tasks.values()].filter((task) => task.missionId === mission.id);
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const tasksByGate = new Map<string, Task[]>();
  for (const task of tasks) {
    if (!task.decisionGateId) continue;
    const group = tasksByGate.get(task.decisionGateId) ?? [];
    group.push(task);
    tasksByGate.set(task.decisionGateId, group);
  }
  const gates = [...store.decisionGates.values()].filter((gate) => gate.missionId === mission.id);
  const planning = gates.filter((gate) => ["PROPOSING", "REVIEWING", "AWAITING_HUMAN"].includes(gate.status));
  const selected = gates.filter((gate) => gate.status === "SELECTED")
    .sort((a, b) => (b.selectedAt ?? b.createdAt).localeCompare(a.selectedAt ?? a.createdAt));
  const repositories = [...store.repositoryBindings.values()].filter((repo) => repo.missionId === mission.id);
  const releases = [...store.publications.values()].filter((release) => release.missionId === mission.id && release.status === "PUBLISHED")
    .sort((a, b) => (b.decidedAt ?? b.createdAt).localeCompare(a.decidedAt ?? a.createdAt));
  const counts = {
    tasks: tasks.length,
    verified: tasks.filter((task) => task.status === "VERIFIED").length,
    active: tasks.filter((task) => ["OPEN", "CLAIMED", "SUBMITTED", "VERIFYING"].includes(task.status)).length,
    blocked: tasks.filter((task) => ["BLOCKED", "DRAFT"].includes(task.status)).length,
    cancelled: tasks.filter((task) => task.status === "CANCELLED").length,
    planning: planning.length, selectedPlans: selected.length, releases: releases.length,
  };
  const blockingRequests = [...store.humanRequests.values()].some((request) =>
    request.missionId === mission.id && request.status === "OPEN" && request.blocking);
  const codeEvidence: MissionProgress["codeEvidence"] = [];
  const contributions = [...store.contributions.values()].filter((item) => taskById.has(item.taskId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const contribution of contributions) {
    for (const evidence of contribution.evidence) {
      if (codeEvidence.length >= 8) break;
      if (evidence.kind !== "CODE" || !evidence.uri) continue;
      let url: URL;
      try { url = new URL(evidence.uri); } catch { continue; }
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) continue;
      const repository = repositories.find((repo) => {
        const base = new URL(repo.repositoryUrl);
        return url.origin === base.origin && (url.pathname.toLowerCase() === base.pathname.toLowerCase()
          || url.pathname.toLowerCase().startsWith(`${base.pathname.toLowerCase()}/`));
      });
      codeEvidence.push({ contributionId: contribution.id, taskId: contribution.taskId,
        taskTitle: taskById.get(contribution.taskId)!.title, author: contribution.author,
        status: contribution.status, uri: evidence.uri, summary: evidence.summary,
        createdAt: contribution.createdAt, repositoryId: repository?.id });
    }
    if (codeEvidence.length >= 8) break;
  }
  return {
    mission, counts, repositories: repositories.slice(0, 10), codeEvidence, latestRelease: releases[0],
    nextAction: mission.status === "COMPLETED" ? "COMPLETE" : mission.status === "ABANDONED" ? "ABANDONED"
      : counts.active ? "BUILD" : counts.blocked || blockingRequests ? "UNBLOCK" : counts.planning ? "REVIEW_PLANS" : "PLAN",
    canComplete: ["ACTIVE", "VERIFYING"].includes(mission.status) && counts.verified > 0
      && counts.active === 0 && counts.blocked === 0 && counts.planning === 0 && !blockingRequests,
    directions: selected.slice(0, 5).map((gate) => {
      const proposal = gate.selectedProposalId ? store.decisionProposals.get(gate.selectedProposalId) : undefined;
      const group = tasksByGate.get(gate.id) ?? [];
      return { gateId: gate.id, title: proposal?.title ?? gate.title, summary: proposal?.summary ?? gate.question,
        selectedAt: gate.selectedAt, totalTasks: group.length,
        verifiedTasks: group.filter((task) => task.status === "VERIFIED").length,
        resolvedTasks: group.filter((task) => ["VERIFIED", "CANCELLED"].includes(task.status)).length };
    }),
  };
}
