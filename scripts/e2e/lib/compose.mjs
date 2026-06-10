/**
 * Docker Compose helpers for E2E backing services and optional OpenClaw gateway container.
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { E2E_DIR, REPO_ROOT } from "./utils.mjs";
import { join } from "node:path";
import { homedir } from "node:os";

export const COMPOSE_FILE = join(E2E_DIR, "docker-compose.yml");
export const DOCKER = process.env.DOCKER_BIN ?? "docker";

const DOCKER_PATH = "/Applications/Docker.app/Contents/Resources/bin";

/** Common Docker Desktop socket paths — avoid hanging `docker info` when daemon is down. */
function dockerSocketPresent() {
  const candidates = [
    process.env.DOCKER_HOST?.replace(/^unix:/, ""),
    `${homedir()}/.docker/run/docker.sock`,
    "/var/run/docker.sock",
  ].filter(Boolean);
  return candidates.some((p) => existsSync(p));
}

/** @returns {NodeJS.ProcessEnv} */
export function dockerEnv() {
  return {
    ...process.env,
    PATH: `${DOCKER_PATH}:/opt/homebrew/bin:${process.env.PATH ?? ""}`,
    OPENCLAW_E2E_REPO: REPO_ROOT,
    OPENCLAW_E2E_STATE_DIR: process.env.OPENCLAW_E2E_STATE_DIR ?? "",
    E2E_GATEWAY_PORT: process.env.E2E_GATEWAY_PORT ?? "19789",
  };
}

/**
 * @param {string} cmd
 * @param {{ stdio?: 'inherit'|'pipe'|'ignore' }} [opts]
 */
export function dockerRun(cmd, opts = {}) {
  console.log(`\n$ ${cmd}`);
  return execSync(cmd, { stdio: opts.stdio ?? "inherit", cwd: REPO_ROOT, env: dockerEnv() });
}

/** @returns {boolean} */
export function dockerOk(timeoutMs = 3_000) {
  if (process.env.OPENCLAW_E2E_SKIP_DOCKER === "1") return false;
  if (!dockerSocketPresent()) return false;
  try {
    execSync(`${DOCKER} info`, { stdio: "ignore", env: dockerEnv(), timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

/** Ensure Docker daemon responds; does not auto-launch Docker Desktop (avoids long hangs). */
export function ensureDockerDaemon() {
  if (dockerOk(5_000)) return { ok: true };
  if (process.env.OPENCLAW_E2E_SKIP_DOCKER === "1") {
    return { ok: false, blocker: "Docker skipped via OPENCLAW_E2E_SKIP_DOCKER=1" };
  }
  return { ok: false, blocker: "Docker daemon not running or not responding (timeout)" };
}

/**
 * Start compose services for selected plugins.
 * @param {string[]} services service names; empty = default backing set only
 * @param {{ includeOpenClaw?: boolean }} [opts]
 */
export function composeUp(services = [], opts = {}) {
  const daemon = ensureDockerDaemon();
  if (!daemon.ok) return daemon;

  const targets = [...services];
  if (opts.includeOpenClaw && !useHostGateway()) {
    targets.push("openclaw");
  }

  const svcArg = targets.length ? targets.join(" ") : "";
  dockerRun(`${DOCKER} compose -f "${COMPOSE_FILE}" up -d ${svcArg}`.trim());
  return { ok: true, services: targets };
}

/** @param {boolean} [removeVolumes] */
export function composeDown(removeVolumes = false) {
  if (!dockerOk()) return;
  try {
    const vol = removeVolumes ? " -v" : "";
    dockerRun(`${DOCKER} compose -f "${COMPOSE_FILE}" down${vol}`, { stdio: "pipe" });
  } catch {
    /* ignore */
  }
}

/** Host gateway fallback when container OpenClaw is impractical. */
export function useHostGateway() {
  return (
    process.env.OPENCLAW_E2E_HOST_GATEWAY === "1" ||
    process.env.OPENCLAW_E2E_HOST_GATEWAY === "true"
  );
}

/**
 * @returns {'host'|'container'|'blocked'}
 */
export function gatewayMode() {
  if (useHostGateway()) return "host";
  if (!dockerOk()) return "blocked";
  return "container";
}

/** @returns {string} */
export function dockerPs() {
  if (!dockerSocketPresent()) return "unavailable (no docker socket)";
  try {
    return execSync(`${DOCKER} ps --format '{{.Names}}\t{{.Status}}'`, {
      encoding: "utf8",
      env: dockerEnv(),
      timeout: 5_000,
    });
  } catch {
    return "unavailable";
  }
}
