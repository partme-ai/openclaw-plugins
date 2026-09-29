/**
 * OpenClaw gateway lifecycle — host process or Docker compose service.
 */
import { execFileSync, execSync, spawn } from "node:child_process";
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

/** Treat an unobservable live PID as unknown, never as stopped. */
export function isGatewayProcessAlive(pid, signal = process.kill, ps = (candidate) =>
  execFileSync("ps", ["-p", String(candidate), "-o", "stat="], { encoding: "utf8" })) {
  try {
    signal(pid, 0);
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
  try {
    const state = ps(pid).trim();
    if (state) return !state.startsWith("Z");
  } catch (error) {
    // ps can race with exit. Confirm ESRCH before treating that race as stopped.
    try {
      signal(pid, 0);
    } catch (followup) {
      if (followup?.code === "ESRCH") return false;
      throw followup;
    }
    throw error;
  }
  try {
    signal(pid, 0);
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
  throw new Error(`Unable to confirm E2E Gateway PID ${pid} process state`);
}

const processLifecycle = {
  isAlive: isGatewayProcessAlive,
  ownsPort(pid, port) {
    try {
      const output = execFileSync("lsof", ["-nP", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" });
      return output.trim().split(/\s+/).includes(String(pid));
    } catch {
      return false;
    }
  },
  signal: (pid, signal) => process.kill(pid, signal),
  pause(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  },
};

/** Stop only this harness's live Gateway; preserve its profile if exit cannot be confirmed. */
export function stopGatewayByPidFile(pidFile, port, lifecycle = processLifecycle, waitMs = 5_000) {
  if (!existsSync(pidFile)) return;
  const pid = Number(readFileSync(pidFile, "utf8"));
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("Invalid E2E Gateway PID file");
  if (!lifecycle.isAlive(pid)) {
    rmSync(pidFile, { force: true });
    return;
  }
  const waitForExit = (timeoutMs = waitMs) => {
    const deadline = performance.now() + timeoutMs;
    while (lifecycle.isAlive(pid) && performance.now() < deadline) lifecycle.pause(50);
    return !lifecycle.isAlive(pid);
  };
  if (!lifecycle.ownsPort(pid, port)) {
    if (waitForExit()) {
      rmSync(pidFile, { force: true });
      return;
    }
    throw new Error(`E2E Gateway PID ${pid} does not own port ${port}; profile preserved`);
  }
  lifecycle.signal(pid, "SIGTERM");
  if (!waitForExit()) {
    if (!lifecycle.ownsPort(pid, port)) {
      // The listener closes before the process finishes its remaining shutdown hooks.
      // Never send a stronger signal after ownership can no longer be proved.
      if (waitForExit(30_000)) {
        rmSync(pidFile, { force: true });
        return;
      }
      throw new Error(`E2E Gateway PID ${pid} ownership changed; profile preserved`);
    }
    lifecycle.signal(pid, "SIGKILL");
    if (!waitForExit()) {
      throw new Error(`E2E Gateway PID ${pid} did not exit; profile preserved`);
    }
  }
  rmSync(pidFile, { force: true });
}

/** Stop host gateway if previously started by E2E. */
export function stopHostGateway() {
  stopGatewayByPidFile(PID_FILE, GATEWAY_PORT);
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
