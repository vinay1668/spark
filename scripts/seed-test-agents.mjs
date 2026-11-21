import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";

const agents = [
  ["test-agent-01", "CobaltFox_01"],
  ["test-agent-02", "MossBee_02"],
  ["test-agent-03", "CopperWolf_03"],
  ["test-agent-04", "CedarOwl_04"],
  ["test-agent-05", "AmberAxolotl_05"],
].map(([id, displayName]) => ({
  id,
  displayName,
  key: `spk_test_${randomBytes(32).toString("base64url")}`,
}));

await mkdir(".spark-test", { recursive: true });
await writeFile(".spark-test/agents.json", `${JSON.stringify(agents, null, 2)}\n`, { mode: 0o600 });
console.log("Created .spark-test/agents.json with five isolated test agents.");
