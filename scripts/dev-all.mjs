import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

try { process.loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url))); } catch {}

const detached = process.platform !== "win32";
const webWorkspace = process.argv.includes("--legacy") ? "@spark/web" : "@spark/web-react";
const serverRoot = fileURLToPath(new URL("../apps/server/", import.meta.url));
const reactRoot = fileURLToPath(new URL("../apps/web-react/", import.meta.url));
const legacyRoot = fileURLToPath(new URL("../apps/web/", import.meta.url));
const tsxCli = fileURLToPath(new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url));
const viteCli = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));
const serverEnv = { ...process.env };
if (!serverEnv.DATABASE_URL && !serverEnv.SPARK_DEV_API_KEY) {
  serverEnv.SPARK_DEV_API_KEY = `spk_local_${randomBytes(32).toString("base64url")}`;
  serverEnv.SPARK_DEV_ACTOR_TYPE = "agent";
  serverEnv.SPARK_DEV_ACTOR_ID = "local-browser-agent";
  serverEnv.SPARK_DEV_ACTOR_NAME = "Local Browser Agent";
  console.log("\nLocal agent key for this run:");
  console.log(serverEnv.SPARK_DEV_API_KEY);
  console.log("Paste it into a task's Claim task panel. It expires when this process stops.\n");
}
const processes = [];
const apiPort = Number(serverEnv.PORT ?? 4010);
const webPort = 4328;

function listeningPids(port) {
  if (process.platform === "win32") return [];
  try {
    return execFileSync("lsof", [`-tiTCP:${port}`, "-sTCP:LISTEN"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split(/\s+/)
      .filter(Boolean)
      .map(Number)
      .filter(Number.isInteger);
  } catch {
    return [];
  }
}

async function replaceExistingSparkProcesses() {
  const ports = [apiPort, webPort];
  const pids = [...new Set(ports.flatMap(listeningPids))];
  if (pids.length === 0) return;

  console.log(`Replacing existing Spark process${pids.length === 1 ? "" : "es"} on port${pids.length === 1 ? "" : "s"} ${ports.join(" and ")}...`);
  for (const pid of pids) {
    try { process.kill(pid, "SIGTERM"); } catch (error) {
      if (error?.code !== "ESRCH") console.warn(`Could not stop process ${pid}: ${error.message}`);
    }
  }

  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (ports.every((port) => listeningPids(port).length === 0)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  for (const port of ports) {
    for (const pid of listeningPids(port)) {
      try { process.kill(pid, "SIGKILL"); } catch (error) {
        if (error?.code !== "ESRCH") console.warn(`Could not force-stop process ${pid}: ${error.message}`);
      }
    }
  }
}

await replaceExistingSparkProcesses();

function spawnChild(command, args, options) {
  const child = spawn(command, args, options);
  processes.push(child);
  return child;
}

const serverProcess = spawnChild(process.execPath, [tsxCli, "watch", "src/server.ts"], {
  cwd: serverRoot,
  stdio: "inherit",
  env: serverEnv,
  detached,
});

async function waitForApi() {
  const deadline = Date.now() + 30_000;
  const healthUrl = `http://127.0.0.1:${apiPort}/health`;
  while (Date.now() < deadline) {
    if (serverProcess.exitCode !== null || serverProcess.signalCode) {
      throw new Error("Spark API stopped before becoming ready");
    }
    try {
      const response = await fetch(healthUrl);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Spark API did not become ready at ${healthUrl}`);
}

try {
  await waitForApi();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
  process.kill(process.pid, "SIGTERM");
}

if (!process.exitCode) {
  if (webWorkspace === "@spark/web-react") {
    spawnChild(process.execPath, [viteCli, "--host", "127.0.0.1", "--port", "4328"], {
      cwd: reactRoot,
      stdio: "inherit",
      detached,
    });
  } else {
    spawnChild(
      process.execPath,
      [fileURLToPath(new URL("../apps/web/dev-server.mjs", import.meta.url))],
      { cwd: legacyRoot, stdio: "inherit", detached },
    );
  }
}

let stopping = false;
function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  for (const child of processes) {
    if (child.exitCode !== null || child.signalCode) continue;
    try {
      // npm -> tsx watch -> node is a process tree. On Unix, kill the whole
      // detached group so Ctrl+C cannot leave the actual listener behind.
      if (detached && child.pid) process.kill(-child.pid, signal);
      else if (process.platform === "win32" && child.pid) {
        spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
        });
      } else child.kill(signal);
    } catch (error) {
      if (error?.code !== "ESRCH") console.error(`Could not stop Spark child ${child.pid}: ${error.message}`);
    }
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => stop(signal));
}

for (const child of processes) {
  child.on("error", (error) => {
    console.error(error.message);
    stop();
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    if (!stopping && code !== 0) {
      console.error(`A Spark development process stopped (${signal ?? code}).`);
      stop();
      process.exitCode = code ?? 1;
    }
  });
}

await Promise.all(processes.map((child) => new Promise((resolve) => child.once("exit", resolve))));
// Give npm/tsx a moment to flush its own shutdown handlers before this runner exits.
if (stopping) await new Promise((resolve) => setTimeout(resolve, 250));
