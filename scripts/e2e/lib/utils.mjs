/**
 * Shared helpers for OpenClaw queue/channel installed-plugin E2E runs.
 */
import net from "node:net";
import { existsSync, rmSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

export const REPO_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
export const E2E_DIR = `${REPO_ROOT}/scripts/e2e`;
export const PROFILE = "queue-e2e";

/** Resolve OpenClaw CLI from repo devDependency or known host install. */
function resolveOpenClawBin() {
  if (process.env.OPENCLAW_BIN) return process.env.OPENCLAW_BIN;
  const candidates = [
    `${REPO_ROOT}/node_modules/.bin/openclaw`,
    `${process.env.HOME}/.openclaw/extensions/wecom/node_modules/.bin/openclaw`,
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0];
}

export const OPENCLAW_BIN = resolveOpenClawBin();
export const STATE_DIR = process.env.OPENCLAW_E2E_STATE_DIR ?? `${process.env.HOME}/.openclaw-${PROFILE}`;
export const GATEWAY_PORT = Number(process.env.E2E_GATEWAY_PORT ?? 19789);
export const GATEWAY_HTTP = `http://127.0.0.1:${GATEWAY_PORT}`;

/**
 * Remove state from the dedicated E2E profile before a fresh install.
 * Refuse paths that do not visibly identify themselves as E2E state unless the
 * caller explicitly opts in; this prevents a typo from deleting a real profile.
 */
export function resetE2EProfile() {
  if (process.env.OPENCLAW_E2E_PRESERVE_STATE === "1") return false;
  const normalized = STATE_DIR.toLowerCase();
  const explicitlyAllowed = process.env.OPENCLAW_E2E_ALLOW_STATE_RESET === "1";
  if (!normalized.includes("e2e") && !explicitlyAllowed) {
    throw new Error(
      `Refusing to reset non-E2E state path: ${STATE_DIR}. ` +
        "Set OPENCLAW_E2E_ALLOW_STATE_RESET=1 only for a disposable profile.",
    );
  }
  rmSync(STATE_DIR, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  return true;
}

/** Installed-plugin E2E ports (defaults match registerService when runtime config loads late). */
export const E2E_PORTS = {
  mqtt: 11883,
  stompTcp: Number(process.env.E2E_STOMP_TCP_PORT ?? 61613),
  webMqttWs: Number(process.env.E2E_WEB_MQTT_PORT ?? 25675),
  webStompWs: Number(process.env.E2E_WEB_STOMP_PORT ?? 15674),
  mtlsHttps: Number(process.env.E2E_MTLS_PORT ?? 18443),
  oauth2Proxy: Number(process.env.E2E_OAUTH2_PROXY_PORT ?? 18081),
  oauth2Provider: Number(process.env.E2E_OAUTH2_PROVIDER_PORT ?? 19090),
  webSocket: Number(process.env.E2E_WEB_SOCKET_PORT ?? 28789),
  modelFixture: Number(process.env.E2E_MODEL_FIXTURE_PORT ?? 19091),
  amapProvider: Number(process.env.E2E_AMAP_PROVIDER_PORT ?? 19092),
  meituanProvider: Number(process.env.E2E_MEITUAN_PROVIDER_PORT ?? 19093),
  rednodeProvider: Number(process.env.E2E_REDNODE_PROVIDER_PORT ?? 19094),
  wechatProvider: Number(process.env.E2E_WECHAT_PROVIDER_PORT ?? 19095),
  wechatIpadProvider: Number(process.env.E2E_WECHAT_IPAD_PROVIDER_PORT ?? 19096),
  wecomKfProvider: Number(process.env.E2E_WECOM_KF_PROVIDER_PORT ?? 19097),
  wecomProvider: Number(process.env.E2E_WECOM_PROVIDER_PORT ?? 19098),
  openmem: Number(process.env.E2E_OPENMEM_PORT ?? 13317),
  otlpHttp: Number(process.env.E2E_OTLP_HTTP_PORT ?? 14318),
  nacosHttp: Number(process.env.E2E_NACOS_HTTP_PORT ?? 18848),
};

/** @param {number} port */
export function tcpReachable(port, host = "127.0.0.1", timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const finish = (ok) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

/**
 * Poll until predicate returns true or timeout.
 * @param {() => Promise<boolean>} predicate
 * @param {{ timeoutMs?: number; intervalMs?: number; label?: string }} opts
 */
export async function waitFor(predicate, opts = {}) {
  const { timeoutMs = 60_000, intervalMs = 500, label = "condition" } = opts;
  // Use the monotonic clock so NTP/desktop wall-clock jumps cannot cause false timeouts.
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (await predicate()) return true;
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label} (${timeoutMs}ms)`);
}

/**
 * @param {string} path
 * @param {RequestInit} [init]
 */
export async function gatewayFetch(path, init) {
  const res = await fetch(`${GATEWAY_HTTP}${path}`, init);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { ok: res.ok, status: res.status, json, text };
}

/** @param {Record<string, unknown>} row */
export function resultRow(row) {
  return {
    plugin: row.plugin,
    installedPath: row.installedPath ?? "—",
    service: row.service ?? "embedded",
    method: row.method ?? "—",
    result: row.result ?? "PENDING",
    blocker: row.blocker ?? "",
    ...row,
  };
}
