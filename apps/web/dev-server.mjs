import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

try { process.loadEnvFile(fileURLToPath(new URL("../../.env", import.meta.url))); } catch {}

const port = Number(process.env.SPARK_WEB_PORT ?? 4328);
const apiUrl = new URL(process.env.SPARK_API_URL ?? "http://127.0.0.1:4010");
const publicDirectory = fileURLToPath(new URL("./public", import.meta.url));
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function proxy(request, response) {
  const targetPath = request.url.replace(/^\/api/, "") || "/";
  const transport = apiUrl.protocol === "https:" ? https : http;
  const upstream = transport.request({
    protocol: apiUrl.protocol,
    hostname: apiUrl.hostname,
    port: apiUrl.port,
    method: request.method,
    path: targetPath,
    headers: { ...request.headers, host: apiUrl.host },
  }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  });
  upstream.on("error", () => {
    response.writeHead(502, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "SPARK_API_UNAVAILABLE" }));
  });
  request.pipe(upstream);
}

async function serveStatic(request, response) {
  const requested = new URL(request.url, "http://localhost").pathname;
  const relative = requested === "/" ? "index.html" : requested.replace(/^\/+/, "");
  const resolved = normalize(join(publicDirectory, relative));
  if (!resolved.startsWith(publicDirectory)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const details = await stat(resolved);
    const file = details.isDirectory() ? join(resolved, "index.html") : resolved;
    if (file.endsWith("index.html")) {
      const html = await readFile(file, "utf8");
      response.writeHead(200, { "content-type": contentTypes[".html"], "cache-control": "no-store" });
      response.end(html.replace("__CLERK_PUBLISHABLE_KEY__", process.env.CLERK_PUBLISHABLE_KEY ?? ""));
      return;
    }
    response.writeHead(200, {
      "content-type": contentTypes[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    createReadStream(file).pipe(response);
  } catch {
    // OAuth providers return to a client-side callback route. Serve the app
    // shell for that route so identity.js can call Clerk's callback handler.
    if (!extname(relative)) {
      const file = join(publicDirectory, "index.html");
      const html = await readFile(file, "utf8");
      response.writeHead(200, { "content-type": contentTypes[".html"], "cache-control": "no-store" });
      response.end(html.replace("__CLERK_PUBLISHABLE_KEY__", process.env.CLERK_PUBLISHABLE_KEY ?? ""));
      return;
    }
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}

const server = http.createServer((request, response) => {
  if (request.url?.startsWith("/api/")) proxy(request, response);
  else void serveStatic(request, response);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Spark web listening at http://127.0.0.1:${port}`);
  console.log(`Proxying API requests to ${apiUrl.origin}`);
});
