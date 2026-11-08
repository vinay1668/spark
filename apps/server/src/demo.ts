import { CoordinationEngine } from "./domain/engine.js";
import type { Actor } from "@spark/contracts";

const creator: Actor = {
  id: "human-vinay",
  type: "human",
  displayName: "Vinay",
};

const coordinator: Actor = {
  id: "agent-coordinator",
  type: "agent",
  displayName: "Coordinator",
};

const builder: Actor = {
  id: "agent-builder",
  type: "agent",
  displayName: "Builder",
};

const reviewer: Actor = {
  id: "agent-reviewer",
  type: "agent",
  displayName: "Reviewer",
};

const documenter: Actor = {
  id: "agent-documenter",
  type: "agent",
  displayName: "Documenter",
};

const engine = new CoordinationEngine();

function show(step: string, value: unknown): void {
  console.log(`\n${step}`);
  console.log(JSON.stringify(value, null, 2));
}

const mission = engine.createMission({
  title: "Build a Markdown link checker",
  description: "Create a small open-source CLI that finds broken links in Markdown files.",
  creator,
  tags: ["developer-tools", "markdown", "cli"],
});
show("1. Human creates a public mission", {
  id: mission.id,
  title: mission.title,
  status: mission.status,
});

const delegation = engine.grantDelegation({
  missionId: mission.id,
  grantedBy: creator,
  agentId: coordinator.id,
  agentDisplayName: coordinator.displayName,
});
show("2. Human authorizes a coordinator agent for this mission", {
  delegationId: delegation.id,
  agent: delegation.agent.displayName,
  authorizedBy: delegation.grantedBy.displayName,
  status: delegation.status,
});

const plan = engine.proposePlan(mission.id, coordinator, [
  {
    key: "build-checker",
    title: "Build the link-checking core",
    objective: "Implement a function that extracts and checks HTTP links from Markdown.",
    acceptanceCriteria: [
      "Extracts inline Markdown links",
      "Reports unreachable links without stopping the whole run",
    ],
    mode: "EXCLUSIVE",
    tags: ["typescript", "http"],
    requiredCapabilities: ["typescript", "http"],
  },
  {
    key: "document-cli",
    title: "Document the CLI",
    objective: "Write clear installation and usage instructions for the finished tool.",
    acceptanceCriteria: ["README contains installation and command examples"],
    mode: "EXCLUSIVE",
    tags: ["documentation"],
    requiredCapabilities: ["technical-writing"],
    dependsOn: ["build-checker"],
  },
]);
show("3. Coordinator agent proposes a plan", {
  planId: plan.id,
  missionStatus: engine.missionView(mission.id).mission.status,
  tasks: plan.tasks.map((task) => task.title),
});

const tasks = engine.approvePlan(mission.id, plan.id, coordinator);
show(
  "4. Authorized coordinator approves the plan for its human owner",
  tasks.map((task) => ({ id: task.id, title: task.title, status: task.status })),
);

const buildTask = tasks.find((task) => task.key === "build-checker")!;
const claim = engine.claimTask(buildTask.id, builder);
show("5. Builder agent claims the open task", {
  claimId: claim.id,
  taskId: claim.taskId,
  status: claim.status,
});

const contribution = engine.submitContribution({
  claimId: claim.id,
  author: builder,
  summary: "Implemented Markdown link extraction and resilient HTTP checking.",
  evidence: [
    {
      kind: "CODE",
      uri: "https://github.com/example/markdown-link-checker/commit/demo",
      summary: "Implementation commit",
    },
    {
      kind: "COMMAND",
      summary: "Manual run found one valid and one intentionally broken link.",
    },
  ],
});
show("6. Builder submits an evidence-backed contribution", {
  contributionId: contribution.id,
  status: contribution.status,
  evidenceCount: contribution.evidence.length,
});

const selfReview = engine.reviewContribution({
  contributionId: contribution.id,
  reviewer: builder,
  verdict: "PASSED",
  findings: ["The implementation meets the requested behavior."],
  evidence: [],
});
show("7. Builder proposes a self-review; it does not advance the task", {
  selfReview: selfReview.selfReview,
  taskStatus: engine.missionView(mission.id).tasks.find((task) => task.id === buildTask.id)?.status,
});

const independentReview = engine.reviewContribution({
  contributionId: contribution.id,
  reviewer,
  verdict: "PASSED",
  findings: ["Code and evidence satisfy both acceptance criteria."],
  evidence: [{ kind: "COMMAND", summary: "Reviewer reproduced the CLI behavior independently." }],
});
show("8. Independent reviewer accepts the contribution", {
  selfReview: independentReview.selfReview,
  verdict: independentReview.status,
  tasks: engine.missionView(mission.id).tasks.map((task) => ({
    title: task.title,
    status: task.status,
  })),
});

const helpRequest = engine.createHumanRequest({
  missionId: mission.id,
  taskId: tasks.find((task) => task.key === "document-cli")!.id,
  requestedBy: coordinator,
  kind: "DECISION",
  blocking: true,
  question: "Should the README recommend global installation or npx usage?",
  reason: "Both are valid product choices and the mission does not specify a preference.",
});
show("9. Agent asks a human for a product decision", {
  requestId: helpRequest.id,
  status: helpRequest.status,
  targetHuman: helpRequest.targetHuman.displayName,
  taskStatus: engine.missionView(mission.id).tasks.find((task) => task.id === helpRequest.taskId)?.status,
  question: helpRequest.question,
});

const answered = engine.answerHumanRequest(
  helpRequest.id,
  creator,
  "Use npx as the primary example and mention global installation as optional.",
);
show("10. Human answers only the blocked decision", {
  status: answered.status,
  answer: answered.answer,
  taskStatus: engine.missionView(mission.id).tasks.find((task) => task.id === helpRequest.taskId)?.status,
});

const documentationTask = tasks.find((task) => task.key === "document-cli")!;
const documentationClaim = engine.claimTask(documentationTask.id, documenter);
const documentationContribution = engine.submitContribution({
  claimId: documentationClaim.id,
  author: documenter,
  summary: "Documented npx usage and optional global installation.",
  evidence: [{ kind: "CODE", summary: "README update matching the human decision." }],
});
engine.reviewContribution({
  contributionId: documentationContribution.id,
  reviewer,
  verdict: "PASSED",
  findings: ["README is clear and follows the answered product decision."],
  evidence: [{ kind: "OTHER", summary: "Reviewer checked both documented command examples." }],
});
show("11. Agents finish the remaining work and complete the mission", {
  missionStatus: engine.missionView(mission.id).mission.status,
  tasks: engine.missionView(mission.id).tasks.map((task) => ({ title: task.title, status: task.status })),
});

engine.registerRepository({
  missionId: mission.id,
  actor: coordinator,
  kind: "NEW_PROJECT",
  sponsorType: "HUMAN",
  sponsorDisplayName: creator.displayName,
  owner: "example",
  repository: "markdown-link-checker",
  githubRepositoryId: 1,
  repositoryUrl: "https://github.com/example/markdown-link-checker",
  defaultBranch: "main",
  proofPath: ".spark/mission.json",
});
const publication = engine.proposePublication({
  missionId: mission.id,
  proposedBy: coordinator,
  title: "Markdown Link Checker",
  version: "1.0.0",
  summary: "A reviewed command-line tool for finding broken links in Markdown files.",
  artifactUri: "https://github.com/example/markdown-link-checker/releases/tag/v1.0.0",
  evidence: [{ kind: "CODE", summary: "Verified repository and accepted mission contributions." }],
  tags: ["developer-tools", "markdown", "cli"],
  capabilities: ["markdown-link-checking"],
});
show("12. Authorized agent proposes a version for publication", {
  publicationId: publication.id,
  version: publication.version,
  status: publication.status,
  targetHuman: publication.targetHuman.displayName,
});

engine.decidePublication({
  publicationId: publication.id,
  decidedBy: creator,
  verdict: "PUBLISHED",
  reason: "The reviewed release is ready for public reuse.",
});
show("13. Human owner publishes the release in Spark", {
  status: publication.status,
  listedPublications: engine.listPublications().length,
});

const reusable = engine.discoverPublications({ capabilities: ["markdown-link-checking"] });
show("14. Another agent discovers the published capability", {
  results: reusable.length,
  title: reusable[0]?.publication.title,
  matchedCapabilities: reusable[0]?.matchedCapabilities,
});

show("15. Public mission event history", engine.missionView(mission.id).events.map((event) => ({
  sequence: event.sequence,
  type: event.type,
  actor: event.actor.displayName,
  ...(event.authority ? { authorizedBy: event.authority.grantedBy.displayName } : {}),
}))); 
