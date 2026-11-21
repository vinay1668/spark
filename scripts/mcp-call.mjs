#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";

const [toolName, inputText = "{}"] = process.argv.slice(2);
if (!toolName) {
  console.error("Usage: node scripts/mcp-call.mjs <tool-name> '<json-input>'");
  process.exit(2);
}

const brokerDir = process.env.SPARK_MCP_BROKER_DIR;
if (brokerDir) {
  await mkdir(brokerDir, { recursive: true });
  const requestId = `${Date.now()}-${process.pid}-${randomUUID()}`;
  const requestPath = resolve(brokerDir, `${requestId}.request.json`);
  const responsePath = resolve(brokerDir, `${requestId}.response.json`);
  await writeFile(requestPath, JSON.stringify({
    toolName,
    inputText,
    apiKey: process.env.SPARK_API_KEY ?? "",
    apiUrl: process.env.SPARK_API_URL ?? "http://127.0.0.1:4010",
  }), { mode: 0o600 });
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const response = JSON.parse(await readFile(responsePath, "utf8"));
      await unlink(responsePath).catch(() => {});
      if (response.error) throw new Error(response.error);
      console.log(response.output);
      process.exit(0);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    }
  }
  throw new Error(`Timed out waiting for Spark MCP broker: ${brokerDir}`);
}

const client = new Client({ name: "spark-e2e-agent", version: "0.1.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve(process.cwd(), "packages/mcp/dist/server.js")],
  env: {
    ...process.env,
    SPARK_API_URL: process.env.SPARK_API_URL ?? "http://127.0.0.1:4010",
    SPARK_API_KEY: process.env.SPARK_API_KEY ?? "",
  },
  stderr: "pipe",
});

await client.connect(transport);
const result = await client.callTool({ name: toolName, arguments: JSON.parse(inputText) });
console.log(JSON.stringify(result));
await client.close();
