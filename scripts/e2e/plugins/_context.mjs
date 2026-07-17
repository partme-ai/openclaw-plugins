/**
 * Shared test context passed to plugin E2E adapters.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { E2E_DIR, STATE_DIR, gatewayFetch, resultRow, tcpReachable, waitFor, E2E_PORTS } from "../lib/utils.mjs";

/**
 * @param {string} path
 */
function readJsonIfExists(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * @param {string[]} pluginIds
 */
export function createTestContext(pluginIds, services = {}) {
  const meta = JSON.parse(readFileSync(join(E2E_DIR, ".e2e-config-meta.json"), "utf8"));
  const gotifySecrets = readJsonIfExists(join(E2E_DIR, ".e2e-secrets.json"));
  const installed = JSON.parse(readFileSync(join(STATE_DIR, ".e2e-installed.json"), "utf8"));
  const pingPayload = JSON.parse(readFileSync(join(E2E_DIR, "datasets/messages/agent-inbound.json"), "utf8"));

  return {
    pluginIds,
    meta,
    gotifySecrets,
    installed,
    pingPayload,
    modelFixture: services.modelFixture ?? null,
    openmemSidecar: services.openmemSidecar ?? null,
    amapProvider: services.amapProvider ?? null,
    meituanProvider: services.meituanProvider ?? null,
    rednodeProvider: services.rednodeProvider ?? null,
    wechatProvider: services.wechatProvider ?? null,
    wechatIpadProvider: services.wechatIpadProvider ?? null,
    wecomKfProvider: services.wecomKfProvider ?? null,
    ports: E2E_PORTS,
    gatewayFetch,
    tcpReachable,
    waitFor,
    installedPath(id) {
      return installed.find((p) => p.id === id)?.path ?? "not found";
    },
    resultRow,
  };
}

/**
 * @param {ReturnType<typeof createTestContext>} ctx
 * @param {string} plugin
 * @param {() => Promise<void>} fn
 * @param {Partial<ReturnType<typeof resultRow>>} meta
 * @param {ReturnType<typeof resultRow>[]} results
 */
export async function runAdapterTest(ctx, plugin, fn, meta, results) {
  try {
    await fn();
    results.push(ctx.resultRow({ plugin, result: "PASS", installedPath: ctx.installedPath(plugin), ...meta }));
  } catch (err) {
    results.push(
      ctx.resultRow({
        plugin,
        result: "FAIL",
        blocker: err instanceof Error ? err.message : String(err),
        installedPath: ctx.installedPath(plugin),
        ...meta,
      }),
    );
  }
}
