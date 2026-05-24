#!/usr/bin/env node
/**
 * Full OpenClaw installed-plugin E2E orchestrator for queue/channel plugins.
 *
 * Steps: Docker → Gotify tokens → build/install plugins → config → gateway → tests → report
 */
import { execSync, spawn } from "node:child_process";
import { existsSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  E2E_DIR,
  OPENCLAW_BIN,
  PROFILE,
  REPO_ROOT,
  STATE_DIR,
  GATEWAY_HTTP,
  GATEWAY_PORT,
  tcpReachable,
  waitFor,
} from "./lib/utils.mjs";

const DOCKER = process.env.DOCKER_BIN ?? "/usr/local/bin/docker";
const DOCKER_PATH = "/Applications/Docker.app/Contents/Resources/bin";
const COMPOSE_FILE = join(E2E_DIR, "docker-compose.yml");
const dockerEnv = {
  ...process.env,
  PATH: `${DOCKER_PATH}:/opt/homebrew/bin:${process.env.PATH ?? ""}`,
};

function run(cmd, opts = {}) {
  console.log(`\n$ ${cmd}`);
  return execSync(cmd, { stdio: "inherit", cwd: REPO_ROOT, env: dockerEnv, ...opts });
}

function dockerOk() {
  try {
    execSync(`${DOCKER} info`, { stdio: "ignore", env: dockerEnv });
    return true;
  } catch {
    return false;
  }
}

function startDockerServices() {
  if (!dockerOk()) {
    console.warn("[docker] daemon unavailable — starting Docker Desktop");
    run("open -a Docker", { stdio: "ignore" });
    execSync("sleep 8");
  }
  if (!dockerOk()) {
    return { ok: false, blocker: "Docker daemon not running after open -a Docker" };
  }
  run(`${DOCKER} compose -f "${COMPOSE_FILE}" up -d`);
  return { ok: true };
}

function stopDockerServices() {
  if (!dockerOk()) return;
  try {
    run(`${DOCKER} compose -f "${COMPOSE_FILE}" down`, { stdio: "pipe" });
  } catch {
    /* ignore */
  }
}

async function waitDockerHealthy() {
  const services = ["openclaw-e2e-rabbitmq", "openclaw-e2e-gotify"];
  for (const name of services) {
    await waitFor(
      () => {
        try {
          const out = execSync(`${DOCKER} inspect -f '{{.State.Health.Status}}' ${name}`, {
            encoding: "utf8",
          }).trim();
          return out === "healthy";
        } catch {
          return false;
        }
      },
      { label: `${name} healthy`, timeoutMs: 120_000 },
    );
  }
  // RocketMQ proxy — best effort
  try {
    await waitFor(() => tcpReachable(8081), { label: "rocketmq proxy 8081", timeoutMs: 180_000 });
  } catch (err) {
    console.warn("[rocketmq] proxy not healthy:", err.message);
  }
}

function startGateway() {
  const logPath = join(E2E_DIR, "gateway.log");
  const out = openSync(logPath, "a");
  const child = spawn(
    OPENCLAW_BIN,
    ["--profile", PROFILE, "gateway", "run", "--force", "--allow-unconfigured", "--port", String(GATEWAY_PORT), "--verbose"],
    { stdio: ["ignore", out, out], detached: true },
  );
  child.unref();
  writeFileSync(join(E2E_DIR, ".gateway.pid"), String(child.pid));
  return child.pid;
}

function stopGateway() {
  const pidFile = join(E2E_DIR, ".gateway.pid");
  if (!existsSync(pidFile)) return;
  try {
    process.kill(Number(readFileSync(pidFile, "utf8")), "SIGTERM");
  } catch {
    /* ignore */
  }
}

async function main() {
  const report = {
    startedAt: new Date().toISOString(),
    docker: {},
    plugins: [],
    e2e: [],
    browser: [],
    commits: execSync("git rev-parse HEAD", { cwd: REPO_ROOT, encoding: "utf8" }).trim(),
  };

  console.log("=== OpenClaw Queue/Channel Installed Plugin E2E ===");

  report.docker = startDockerServices();
  if (report.docker.ok) {
    await waitDockerHealthy();
    run(`node "${join(E2E_DIR, "setup-gotify-tokens.mjs")}"`);
  } else {
    console.warn("[docker] BLOCKED:", report.docker.blocker);
  }

  run(`node "${join(E2E_DIR, "install-plugins.mjs")}"`);
  if (report.docker.ok) {
    run(`node "${join(E2E_DIR, "generate-openclaw-config.mjs")}"`);
    run(`node "${join(E2E_DIR, "bootstrap-rocketmq-topic.mjs")}"`);
  }

  stopGateway();
  startGateway();
  await waitFor(() => tcpReachable(GATEWAY_PORT), { label: `gateway :${GATEWAY_PORT}`, timeoutMs: 90_000 });

  const { runAllPluginTests, results } = await import("./test-installed-plugins.mjs");
  await runAllPluginTests();
  report.e2e = results;

  const { runBrowserTests, browserResults } = await import("./browser-web-channels.mjs");
  await runBrowserTests();
  report.browser = browserResults;

  try {
    const list = execSync(`${OPENCLAW_BIN} --profile ${PROFILE} plugins list`, { encoding: "utf8" });
    report.pluginsList = list;
  } catch (err) {
    report.pluginsList = String(err);
  }

  try {
    report.dockerPs = execSync(`${DOCKER} ps --format '{{.Names}}\t{{.Status}}'`, { encoding: "utf8" });
  } catch {
    report.dockerPs = "unavailable";
  }

  report.finishedAt = new Date().toISOString();
  const reportPath = join(E2E_DIR, "e2e-report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log("\n=== E2E Results ===");
  for (const r of report.e2e) {
    console.log(`${r.plugin.padEnd(12)} ${r.result.padEnd(6)} ${r.method ?? ""} ${r.blocker ?? ""}`);
  }
  console.log("\nBrowser:");
  for (const r of report.browser) {
    console.log(`${r.plugin.padEnd(12)} ${r.result.padEnd(6)} ${r.blocker ?? r.evidence ?? ""}`);
  }
  console.log(`\nReport: ${reportPath}`);
  console.log(`Gateway: ${GATEWAY_HTTP}`);

  const failed = report.e2e.filter((r) => r.result === "FAIL").length;
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
