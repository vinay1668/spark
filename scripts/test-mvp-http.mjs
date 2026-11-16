import assert from "node:assert/strict";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { registerRoutes } from "../apps/server/dist/api/routes.js";
import { CoordinationEngine } from "../apps/server/dist/domain/engine.js";
import { agentScopes, humanScopes } from "../apps/server/dist/auth/authenticator.js";

const app = Fastify();
const human = { id: "owner", type: "human", displayName: "Owner" };
const agent = { id: "builder", type: "agent", displayName: "Builder" };
registerRoutes(app, new CoordinationEngine(), {
  async authenticate(header) {
    if (header === "Bearer human") return { actor: human, scopes: humanScopes };
    if (header === "Bearer agent") return { actor: agent, scopes: agentScopes };
    return null;
  },
  async close() {},
});

async function post(url, payload, token, status = 201) {
  const response = await app.inject({
    method: "POST", url, payload,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  assert.equal(response.statusCode, status, response.body);
  return response.json();
}

try {
  const mission = await post("/v1/missions", {
    title: "MVP workflow", description: "Exercise the human and agent planning workflow.",
  }, "human");
  const path = `/v1/missions/${mission.id}`;
  const gate = await post(`${path}/decision-gates`, {
    level: "MISSION", risk: "LOW", title: "Initial plan", question: "What do we build first?",
  }, "human");
  const thread = `/v1/decision-gates/${gate.id}`;
  const proposal = await post(`${thread}/proposals`, {
    title: "Build first", summary: "Implement the first testable task.",
    tasks: [{ key: "first", title: "First task", objective: "Implement a testable result", acceptanceCriteria: ["Evidence supplied"], mode: "EXCLUSIVE" }],
    attachments: [{ id: randomUUID(), url: `/uploads/${randomUUID()}`, name: "notes.txt", mimeType: "text/plain", size: 5, uploadedBy: human, uploadedAt: new Date().toISOString() }],
  }, "human");
  const ballot = { rankedProposalIds: [proposal.id] };
  await post(`${thread}/ballots`, ballot, "agent", 409);
  await post(`${path}/agent-interest`, { action: "JOIN" }, "agent", 200);
  await post(`${thread}/ballots`, ballot, "human", 409);
  await post(`${thread}/ballots`, ballot, "agent");
  const view = (await app.inject(path)).json();
  assert.equal(view.decisionGates[0].status, "SELECTED");
  await post(`/v1/tasks/${view.tasks[0].id}/claims`, {}, "agent");
  const entry = await post(`${path}/board`, { type: "FINDING", summary: "Work has started" }, "agent");
  await post(`${path}/board`, { type: "COMMENT", summary: "Thanks for the update", references: [{ relation: "REPLIES_TO", entryId: entry.id }] }, "human");
  await post(`${path}/board/${entry.id}/vote`, { value: "UP" }, null, 401);
  const vote = await post(`${path}/board/${entry.id}/vote`, { value: "UP" }, "human", 200);
  assert.equal(vote.voteCount, 1);
  console.log("Human and agent HTTP workflow passed.");
} finally {
  await app.close();
}
