/**
 * OpenClaw gateway lifecycle — host process or Docker compose service.
 */
import { execSync, spawn } from "node:child_process";
import { existsSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { COMPOSE_FILE, DOCKER, dockerEnv, dockerOk, useHostGateway } from "./compose.mjs";
import { E2E_DIR, GATEWAY_HTTP, GATEWAY_PORT, OPENCLAW_BIN, PROFILE, gatewayFetch, tcpReachable, waitFor } from "./utils.mjs";

/** Wait until gateway accepts HTTP in addition to TCP (channels may still be warming up). */
async function waitGatewayHttpReady() {
  await waitFor(async () => {
    if (!(await tcpReachable(GATEWAY_PORT))) return false;
    try {
      const res = await gatewayFetch("/readyz");
      return res.ok && res.json?.ready === true;
    } catch {
      return false;
    }
  }, { label: "gateway HTTP ready", timeoutMs: 120_000 });
}

const PID_FILE = join(E2E_DIR, ".gateway.pid");
const LOG_FILE = join(E2E_DIR, "gateway.log");

/** Stop host gateway if previously started by E2E. */
export function stopHostGateway() {
  if (!existsSync(PID_FILE)) return;
  const pid = Number(readFileSync(PID_FILE, "utf8"));
  try {
    process.kill(pid, "SIGTERM");
    const sleeper = new Int32Array(new SharedArrayBuffer(4));
    const deadline = performance.now() + 2_000;
    while (performance.now() < deadline) {
      try {
        process.kill(pid, 0);
        Atomics.wait(sleeper, 0, 0, 50);
      } catch {
        break;
      }
    }
  } catch {
    /* ignore */
  } finally {
    rmSync(PID_FILE, { force: true });
  }
}

/**
 * Start OpenClaw gateway on host (fallback / default when OPENCLAW_E2E_HOST_GATEWAY=1).
 * @returns {number} pid
 */
export function startHostGateway() {
  stopHostGateway();
  const out = openSync(LOG_FILE, "w");
  const child = spawn(
    OPENCLAW_BIN,
    [
      "--profile",
      PROFILE,
      "gateway",
      "run",
      "--force",
      "--allow-unconfigured",
      "--port",
      String(GATEWAY_PORT),
      "--verbose",
    ],
    { stdio: ["ignore", out, out], detached: true, env: process.env },
  );
  child.unref();
  writeFileSync(PID_FILE, String(child.pid));
  return child.pid;
}

/** Start or restart openclaw compose service. */
export function restartContainerGateway() {
  if (useHostGateway() || !dockerOk()) return { mode: "host-skipped" };
  execSync(`${DOCKER} compose -f "${COMPOSE_FILE}" up -d --force-recreate openclaw`, {
    stdio: "inherit",
    env: dockerEnv(),
  });
  return { mode: "container" };
}

/**
 * Ensure gateway is reachable using configured mode.
 * @returns {Promise<{ mode: 'host'|'container'; pid?: number }>}
 */
export async function ensureGatewayRunning() {
  stopHostGateway();

  if (useHostGateway()) {
    const pid = startHostGateway();
    await waitGatewayHttpReady();
    return { mode: "host", pid };
  }

  if (dockerOk()) {
    restartContainerGateway();
    await waitGatewayHttpReady();
    return { mode: "container" };
  }

  const pid = startHostGateway();
  await waitGatewayHttpReady();
  return { mode: "host", pid };
}

/** @returns {string} tail of gateway log for reports */
export function gatewayLogTail(maxLines = 40) {
  if (!existsSync(LOG_FILE)) return "";
  const lines = readFileSync(LOG_FILE, "utf8").split("\n");
  return lines.slice(-maxLines).join("\n");
}
