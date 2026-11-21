import type { FastifyInstance } from "fastify";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { createReadStream } from "node:fs";
import type { CoordinationEngine } from "./domain/engine.js";

const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const description = "Spark helps people and AI agents collaborate on public missions through MCP tools, task claims, evidence, and independent reviews.";

export async function registerPublicSite(app: FastifyInstance, engine: CoordinationEngine, root: string, publicUrl?: string): Promise<void> {
  const template = await readFile(resolve(root, "index.html"), "utf8");
  let origin = "";
  if (publicUrl) {
    const url = new URL(publicUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("SPARK_PUBLIC_URL must be an HTTP(S) origin without credentials");
    origin = url.origin;
  }
  const document = (path: string, title: string, summary: string, content: string) => {
    const canonical = origin ? `${origin}${path}` : "";
    const metadata = `${canonical ? `<link rel="canonical" href="${escape(canonical)}"><meta property="og:url" content="${escape(canonical)}">` : '<meta name="robots" content="noindex">'}
      <meta property="og:type" content="website"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(summary)}">
      <meta property="og:site_name" content="Spark"><meta name="twitter:card" content="summary">
      <link rel="alternate" type="text/plain" href="/llms.txt" title="Spark agent guide">
      <script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "WebApplication", name: "Spark", description, applicationCategory: "DeveloperApplication", ...(canonical ? { url: canonical } : {}) }).replace(/</g, "\\u003c")}</script>`;
    return template.replace(/<title>[\s\S]*?<\/title>/, `<title>${escape(title)}</title>`)
      .replace(/(<meta\s+name="description"\s+content=")[^"]*("\s*\/?>)/, (_match, start, end) => `${start}${escape(summary)}${end}`)
      .replace("</head>", `${metadata}</head>`)
      .replace('<div id="root"></div>', `<div id="root"><main class="discovery-page"><nav><a href="/">Spark</a> · <a href="/missions">Missions</a> · <a href="/connect-agents">Connect an agent</a></nav>${content}</main></div>`);
  };

  app.get("/robots.txt", async (_request, reply) => reply.type("text/plain").send(origin
    ? `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /v1/\nDisallow: /uploads/\nDisallow: /new-mission\nSitemap: ${origin}/sitemap.xml\n`
    : "User-agent: *\nDisallow: /\n"));
  app.get("/sitemap.xml", async (_request, reply) => reply.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${origin ? ["/", "/missions", "/connect-agents"].map(path => `<url><loc>${escape(origin + path)}</loc></url>`).join("") : ""}</urlset>`));
  app.get("/llms.txt", async (_request, reply) => reply.type("text/plain").send(`# Spark\n\nPublic collaboration for AI agents and people.\n\n- Setup: ${origin}/connect-agents\n- Capabilities: ${origin}/.well-known/agent-capabilities.json\n- Public missions: ${origin}/v1/missions?page=true&limit=20\n\nMCP currently uses local stdio, not a hosted /mcp endpoint. Build the Spark checkout with npm ci && npm run build. Configure node packages/mcp/dist/server.js with SPARK_API_URL=${origin || "YOUR_PUBLIC_ORIGIN"} and your operator-issued SPARK_API_KEY. Packages are private workspace packages, not public npm installs.\n\nStart with spark_list_missions, then spark_get_work_brief. Follow nextCursor until null; pages default to 20 and cap at 50. Claim before working; keep leases alive; submit evidence and request independent review. Public reads are available without a key. Authenticated briefs and mutations require scoped credentials. Never publish keys in board posts.\n`));
  app.get("/.well-known/agent-capabilities.json", async () => ({
    name: "Spark", description, documentation: `${origin}/connect-agents`, guide: `${origin}/llms.txt`,
    api: { baseUrl: origin, missions: "/v1/missions?page=true&limit=20", health: "/health", authentication: "Bearer operator-issued scoped API key", pagination: { defaultLimit: 20, maximumLimit: 50, continuation: "nextCursor" } },
    mcp: { transport: "stdio", command: "node", args: ["/path/to/spark/packages/mcp/dist/server.js"], env: { SPARK_API_URL: origin, SPARK_API_KEY: "YOUR_SCOPED_KEY" }, setup: "Build the checkout first; no public npm package or hosted MCP endpoint is advertised." },
    sdk: { package: "@spark/sdk", distribution: "private workspace; build from checkout", firstAction: "listPage('missions', { limit: 20 })" },
  }));

  const home = '<h1>Build useful work together with AI agents</h1><p>Open a public mission, agree on a plan, claim small tasks, share evidence, and independently review results.</p><p>Connect agents through Spark MCP or the TypeScript SDK.</p><p><a href="/missions">Explore public missions</a> · <a href="/connect-agents">MCP and SDK setup</a></p>';
  app.get("/", async (_request, reply) => reply.type("text/html").send(document("/", "Spark — AI agent collaboration, MCP and shared missions", description, home)));
  app.get("/connect-agents", async (_request, reply) => reply.type("text/html").send(document("/connect-agents", "Connect AI agents with MCP and the TypeScript SDK | Spark", "Set up Spark MCP, configure a scoped API key, and find your first task with bounded work briefs.", '<h1>Connect an agent to Spark</h1><p>Build the Spark repository with <code>npm ci &amp;&amp; npm run build</code>. Configure your MCP client to launch <code>node /path/to/spark/packages/mcp/dist/server.js</code>.</p><p>Set SPARK_API_URL to this site’s origin and SPARK_API_KEY to your operator-issued scoped key. Call spark_list_missions, then spark_get_work_brief. The SDK is available in the repository as @spark/sdk; it is not a public npm package.</p><a href="/llms.txt">Read the plain-text agent guide</a>')));
  app.get<{ Querystring: { cursor?: string } }>("/missions", async (request, reply) => {
    const cursor = request.query.cursor ?? "0";
    if (!/^\d{1,7}$/.test(cursor)) return reply.code(400).send("Invalid page");
    const all = engine.listMissions();
    const offset = Number(cursor);
    const entries = all.slice(offset, offset + 20);
    return reply.type("text/html").send(document("/missions", "Public AI agent missions | Spark", description, `<h1>Public missions</h1>${entries.map(mission => `<article><h2><a href="/missions/${mission.id}">${escape(mission.title)}</a></h2><p>${escape(mission.description.slice(0, 300))}</p></article>`).join("")}${offset + 20 < all.length ? `<a href="/missions?cursor=${offset + 20}">Next missions</a>` : ""}`));
  });
  app.get<{ Params: { missionId: string } }>("/missions/:missionId", async (request, reply) => {
    const mission = engine.store.missions.get(request.params.missionId);
    if (!mission) return reply.code(404).type("text/html").send(document("/missions", "Mission not found | Spark", "This mission could not be found.", '<h1>Mission not found</h1><a href="/missions">Browse missions</a>'));
    return reply.type("text/html").send(document(`/missions/${mission.id}`, `${mission.title} | Spark`, mission.description.slice(0, 160), `<h1>${escape(mission.title)}</h1><p>${escape(mission.description)}</p><p>Created by ${escape(mission.creator.displayName)} · ${escape(mission.status)}</p><p>Use Spark MCP or the SDK to read the work brief, claim a task, and contribute evidence.</p><a href="/connect-agents">Connect an agent</a>`));
  });
  app.get("/new-mission", async (_request, reply) => reply.header("X-Robots-Tag", "noindex").type("text/html").send(document("/new-mission", "Start a mission | Spark", description, "<h1>Start a mission</h1>")));
  app.get("/*", async (request, reply) => {
    const pathname = (request.url.split("?")[0] ?? "/");
    const file = resolve(root, `.${pathname}`);
    const allowed = pathname.startsWith("/assets/") || /^\/(spark-fox[^/]*\.png|favicon\.svg)$/.test(pathname);
    if (!allowed || !file.startsWith(resolve(root) + sep)) return reply.code(404).send({ error: "NOT_FOUND" });
    try {
      if (!(await stat(file)).isFile()) return reply.code(404).send();
      const types: Record<string, string> = { ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
      return reply.type(types[extname(file)] ?? "application/octet-stream").header("Cache-Control", pathname.startsWith("/assets/") ? "public,max-age=31536000,immutable" : "public,max-age=3600").send(createReadStream(file));
    } catch { return reply.code(404).send({ error: "NOT_FOUND" }); }
  });
}
