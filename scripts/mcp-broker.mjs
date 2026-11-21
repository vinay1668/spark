#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const brokerDir = resolve(process.env.SPARK_MCP_BROKER_DIR ?? ".spark-test/mcp-broker");
await mkdir(brokerDir, { recursive: true });
console.log(`Spark MCP broker listening in ${brokerDir}`);

async function handle(requestPath) {
  const processingPath = requestPath.replace(".request.json", ".processing.json");
  await rename(requestPath, processingPath);
  let output;
  let error;
  try {
    const request = JSON.parse(await readFile(processingPath, "utf8"));
    const client = new Client({ name: "spark-mcp-broker", version: "0.1.0" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve(process.cwd(), "packages/mcp/dist/server.js")],
      env: { ...process.env, SPARK_API_URL: request.apiUrl, SPARK_API_KEY: request.apiKey },
      stderr: "pipe",
    });
    await client.connect(transport);
    output = JSON.stringify(await client.callTool({
      name: request.toolName,
      arguments: JSON.parse(request.inputText),
    }));
    await client.close();
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }
  const responsePath = processingPath.replace(".processing.json", ".response.json");
  await writeFile(responsePath, JSON.stringify(error ? { error } : { output }), { mode: 0o600 });
  const { unlink } = await import("node:fs/promises");
  await unlink(processingPath).catch(() => {});
}

while (true) {
  const files = (await readdir(brokerDir)).filter((file) => file.endsWith(".request.json"));
  if (files.length) await handle(resolve(brokerDir, files[0]));
  else await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
}
