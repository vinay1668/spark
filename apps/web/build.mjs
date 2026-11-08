import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

try { process.loadEnvFile(fileURLToPath(new URL("../../.env", import.meta.url))); } catch {}

await rm(new URL("./dist", import.meta.url), { recursive: true, force: true });
await mkdir(new URL("./dist", import.meta.url), { recursive: true });
await cp(new URL("./public", import.meta.url), new URL("./dist", import.meta.url), { recursive: true });
const indexUrl = new URL("./dist/index.html", import.meta.url);
const html = await readFile(indexUrl, "utf8");
await writeFile(indexUrl, html.replace("__CLERK_PUBLISHABLE_KEY__", process.env.CLERK_PUBLISHABLE_KEY ?? ""));
console.log("Built Spark web to apps/web/dist");
