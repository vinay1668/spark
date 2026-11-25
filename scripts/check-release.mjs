import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { checkDeploymentAuth } from "./deployment-auth.mjs";

const root = resolve(import.meta.dirname, "..");
for (const file of ["apps/server/dist/server.js", "apps/server/dist/public-site.js", "apps/web-react/dist/index.html", "packages/mcp/dist/server.js", "packages/sdk/dist/index.js", "packages/sdk/dist/index.d.ts", "packages/contracts/dist/index.js"]) await access(resolve(root, file));
for (const name of ["sdk", "mcp", "contracts"]) {
  const manifest = JSON.parse(await readFile(resolve(root, `packages/${name}/package.json`), "utf8"));
  if (!manifest.private) throw new Error(`Review distribution instructions: ${name} is no longer a private workspace package`);
}
const html = await readFile(resolve(root, "apps/web-react/dist/index.html"), "utf8");
if (html.includes("__CLERK_PUBLISHABLE_KEY__")) throw new Error("Frontend Clerk placeholder was not replaced");
if (process.argv.includes("--production")) {
  const missing = ["DATABASE_URL", "SPARK_API_KEY_PEPPER", "CLERK_SECRET_KEY", "CLERK_PUBLISHABLE_KEY"].filter(key => !process.env[key]);
  if (missing.length) throw new Error(`Set production environment variables: ${missing.join(", ")}`);
  const authMode = checkDeploymentAuth(process.env);
  if (authMode === "demo") console.warn("Demo deployment: Clerk development instance enabled. Real Clerk authentication remains required; development limits apply.");
  if (Buffer.byteLength(process.env.SPARK_API_KEY_PEPPER) < 32) throw new Error("SPARK_API_KEY_PEPPER must be at least 32 bytes");
  const origin = new URL(process.env.SPARK_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || "");
  if (origin.protocol !== "https:" || origin.username || origin.password) throw new Error("Set a public HTTPS origin without credentials");
  if (!html.includes(process.env.CLERK_PUBLISHABLE_KEY)) throw new Error("Rebuild React with the production Clerk publishable key");
}
console.log("Release artifacts verified. SDK/MCP are checkout-based; no public package publication is implied.");
