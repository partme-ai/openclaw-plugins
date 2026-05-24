/**
 * Shared helpers for OpenClaw queue/channel installed-plugin E2E runs.
 */
import net from "node:net";
import { setTimeout as sleep } from "node:timers/promises";

export const REPO_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
export const E2E_DIR = `${REPO_ROOT}/scripts/e2e`;
export const PROFILE = "queue-e2e";
export const OPENCLAW_BIN =
  process.env.OPENCLAW_BIN ??
  `${process.env.HOME}/.openclaw/extensions/wecom/node_modules/.bin/openclaw`;
export const STATE_DIR = `${process.env.HOME}/.openclaw-${PROFILE}`;
export const GATEWAY_PORT = Number(process.env.E2E_GATEWAY_PORT ?? 19789);
export const GATEWAY_HTTP = `http://127.0.0.1:${GATEWAY_PORT}`;

/** Installed-plugin E2E ports (defaults match registerService when runtime config loads late). */
export const E2E_PORTS = {
  mqtt: 11883,
  stompTcp: Number(process.env.E2E_STOMP_TCP_PORT ?? 61613),
  webMqttWs: Number(process.env.E2E_WEB_MQTT_PORT ?? 25675),
  webStompWs: Number(process.env.E2E_WEB_STOMP_PORT ?? 15674),
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
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
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
