/**
 * OpenClaw gateway lifecycle — host process or Docker compose service.
 */
import { execFileSync, execSync, spawn } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { COMPOSE_FILE, DOCKER, dockerEnv, dockerOk, useHostGateway } from "./compose.mjs";
import { MANAGEMENT_E2E_GATEWAY_TOKEN } from "./config.mjs";
import { readContainerHostBaseline, readHostBaseline } from "./host-baseline.mjs";
import { E2E_DIR, GATEWAY_HTTP, GATEWAY_PORT, OPENCLAW_BIN, PROFILE, gatewayFetch, tcpReachable, waitFor } from "./utils.mjs";

/** Wait until gateway accepts HTTP in addition to TCP (channels may still be warming up). */
async function waitGatewayHttpReady() {
  await waitFor(async () => {
    if (!(await tcpReachable(GATEWAY_PORT))) return false;
    try {
      const res = await gatewayFetch("/readyz", useHostGateway() ? undefined : {
        headers: { Authorization: `Bearer ${MANAGEMENT_E2E_GATEWAY_TOKEN}` },
      });
      return res.ok && res.json?.ready === true;
    } catch {
      return false;
    }
  }, { label: "gateway HTTP ready", timeoutMs: 120_000 });
}

const PID_FILE = join(E2E_DIR, ".gateway.pid");
const LOG_FILE = join(E2E_DIR, "gateway.log");
let startedHostGateway;

/** Resolve a selected pnpm bin shim to the installed package's Node entry. */
export function resolveHostGatewayCli(cliPath) {
  const selected = realpathSync(cliPath);
  const firstLine = readFileSync(selected, "utf8").split("\n", 1)[0];
  if (/^#!.*\bnode\b/.test(firstLine)) return selected;
  if (!/^#!.*\b(?:sh|bash)\b/.test(firstLine)) {
    throw new Error(`Unsupported OpenClaw CLI launcher: ${selected}`);
  }
  const packageDir = join(dirname(selected), "..", "openclaw");
  const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  if (manifest.name !== "openclaw" || typeof manifest.bin?.openclaw !== "string") {
    throw new Error(`Invalid OpenClaw CLI package beside ${selected}`);
  }
  return realpathSync(join(packageDir, manifest.bin.openclaw));
}

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
  identity(pid) {
    const birthTime = execFileSync("ps", ["-p", String(pid), "-o", "lstart="], { encoding: "utf8" }).trim();
    if (!birthTime) throw new Error(`Unable to identify E2E Gateway PID ${pid}`);
    return birthTime;
  },
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
  const raw = readFileSync(pidFile, "utf8").trim();
  const record = raw.startsWith("{") ? JSON.parse(raw) : { pid: Number(raw) };
  const pid = record.pid;
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("Invalid E2E Gateway PID file");
  if (!lifecycle.isAlive(pid)) {
    rmSync(pidFile, { force: true });
    return;
  }
  if (typeof record.birthTime !== "string" || !record.birthTime.trim()) {
    throw new Error(`Unverified legacy PID ${pid}; profile preserved`);
  }
  const sameProcessAlive = () => {
    if (!lifecycle.isAlive(pid)) return false;
    if (lifecycle.identity(pid) !== record.birthTime) {
      throw new Error(`E2E Gateway PID ${pid} identity mismatch; profile preserved`);
    }
    return true;
  };
  sameProcessAlive();
  const waitForExit = (timeoutMs = waitMs) => {
    const deadline = performance.now() + timeoutMs;
    while (sameProcessAlive() && performance.now() < deadline) lifecycle.pause(50);
    return !sameProcessAlive();
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
    sameProcessAlive();
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
  startedHostGateway = undefined;
}

/** Record an owned child before detaching it; failed startup must not leave an untracked Gateway. */
export function recordHostGatewayLaunch(child, pidFile, lifecycle = processLifecycle, writePid = writeFileSync, timeoutMs = 1_000) {
  if (!Number.isSafeInteger(child.pid) || child.pid <= 0) throw new Error("Unable to start E2E Gateway child");
  const pendingFile = `${pidFile}.${child.pid}.pending`;
  try {
    let birthTime;
    const deadline = performance.now() + timeoutMs;
    while (!birthTime && performance.now() < deadline) {
      try { birthTime = lifecycle.identity(child.pid); }
      catch { lifecycle.pause(20); }
    }
    if (!birthTime) throw new Error("Unable to record E2E Gateway process identity");
    writePid(pendingFile, JSON.stringify({ pid: child.pid, birthTime }));
    renameSync(pendingFile, pidFile);
    child.unref();
    return birthTime;
  } catch (error) {
    rmSync(pendingFile, { force: true });
    if (child.exitCode === null && child.signalCode === null) {
      if (!existsSync(pidFile)) {
        const diagnosticFile = `${pidFile}.${child.pid}.diagnostic`;
        try {
          writeFileSync(diagnosticFile, JSON.stringify({ pid: child.pid, status: "unverified-launch" }));
          renameSync(diagnosticFile, pidFile);
        } catch {
          rmSync(diagnosticFile, { force: true });
          // The error below retains the PID even when the file cannot be written.
        }
      }
      let signaled;
      try { signaled = child.kill("SIGKILL"); }
      catch (killError) {
        throw new AggregateError([error, killError], `E2E Gateway launch cleanup failed for PID ${child.pid}`);
      }
      if (!signaled) {
        throw new AggregateError([error, new Error("SIGKILL was not delivered")],
          `E2E Gateway launch cleanup failed for PID ${child.pid}`);
      }
      // A delivered signal is not an exit confirmation. Keep the PID record until
      // Node observes child exit; if it never exits, the launch remains diagnosable.
      child.once("exit", () => rmSync(pidFile, { force: true }));
      throw error;
    }
    rmSync(pidFile, { force: true });
    throw error;
  }
}

/**
 * Start OpenClaw gateway on host (fallback / default when OPENCLAW_E2E_HOST_GATEWAY=1).
 * @returns {number} pid
 */
export function startHostGateway() {
  stopHostGateway();
  const cliPath = resolveHostGatewayCli(OPENCLAW_BIN);
  const out = openSync(LOG_FILE, "w");
  const spawnedAt = Date.now();
  let child;
  try {
    child = spawn(
      process.execPath,
      [
        cliPath,
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
  } finally {
    closeSync(out);
  }
  recordHostGatewayLaunch(child, PID_FILE);
  startedHostGateway = { child, cliPath, spawnedAt };
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

/** Baseline for the process actually started by ensureGatewayRunning. */
export async function readStartedGatewayBaseline(gateway) {
  if (gateway.mode === "container") return readContainerHostBaseline(DOCKER);
  const launch = startedHostGateway;
  if (!launch || launch.child.pid !== gateway.pid || launch.child.exitCode !== null ||
      launch.child.signalCode !== null || !processLifecycle.isAlive(gateway.pid) ||
      !processLifecycle.ownsPort(gateway.pid, GATEWAY_PORT)) {
    throw new Error("Gateway PID is not the live listener started by this E2E run");
  }
  return readHostBaseline(launch.cliPath, gateway.pid, { spawnedAt: launch.spawnedAt, nodeExecutable: process.execPath });
}

/** @returns {string} tail of gateway log for reports */
export function gatewayLogTail(maxLines = 40) {
  if (!existsSync(LOG_FILE)) return "";
  const lines = readFileSync(LOG_FILE, "utf8").split("\n");
  return lines.slice(-maxLines).join("\n");
}
