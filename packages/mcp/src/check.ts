import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve } from "node:path";

const client = new Client({ name: "spark-connection-check", version: "0.1.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve(process.cwd(), "dist/server.js")],
  env: {
    SPARK_API_URL: process.env.SPARK_API_URL ?? "http://127.0.0.1:4010",
    SPARK_API_KEY: process.env.SPARK_API_KEY ?? "",
  },
  stderr: "pipe",
});

await client.connect(transport);
const { tools } = await client.listTools();
console.log(JSON.stringify({ connected: true, tools: tools.map((tool) => tool.name) }, null, 2));
await client.close();
