/**
 * Merge per-plugin config fragments into ~/.openclaw-queue-e2e/openclaw.json.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadPluginConfigs } from "../config/plugins/index.mjs";
import { PLUGIN_REGISTRY, resolvePlugins } from "./registry.mjs";
import { E2E_DIR, GATEWAY_PORT, STATE_DIR } from "./utils.mjs";

/**
 * Installed plugin ids from prior install step (may include plugins outside this run).
 * @returns {string[]}
 */
function readInstalledPlugins() {
  const path = join(STATE_DIR, ".e2e-installed.json");
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * @param {string[]|undefined} pluginIds
 * @param {{ gotifySecrets?: Record<string, unknown> }} [opts]
 */
export function generateOpenClawConfig(pluginIds, opts = {}) {
  const ids = resolvePlugins(pluginIds);
  const installed = readInstalledPlugins();
  const installedIds = installed.map((plugin) => plugin.id);
  const secretsPath = join(E2E_DIR, ".e2e-secrets.json");
  let gotifySecrets = opts.gotifySecrets;
  if (!gotifySecrets && ids.includes("gotify") && existsSync(secretsPath)) {
    gotifySecrets = JSON.parse(readFileSync(secretsPath, "utf8"));
  }

  const e2eTopic = `openclaw-e2e-${Date.now()}`;
  const ctx = { e2eTopic, gotifySecrets, gatewayPort: GATEWAY_PORT };

  const fragments = loadPluginConfigs(ids, ctx);

  /** Disable installed plugins not in this run so gateway startup does not require their config. */
  for (const installedId of installedIds) {
    if (ids.includes(installedId)) continue;
    fragments.pluginEntries[installedId] = { enabled: false };
  }

  /** Ensure registry-known plugins not installed are not referenced. */
  for (const def of PLUGIN_REGISTRY) {
    if (!ids.includes(def.id) && !installedIds.includes(def.id)) {
      delete fragments.pluginEntries[def.id];
    }
  }

  const config = {
    gateway: {
      mode: "local",
      port: GATEWAY_PORT,
      bind: "loopback",
      auth: { mode: "none" },
    },
    session: { dmScope: "main" },
    plugins: {
      allow: ids,
      load: {
        paths: installed
          .filter((plugin) => ids.includes(plugin.id))
          .map((plugin) => plugin.path),
      },
      entries: fragments.pluginEntries,
    },
    channels: fragments.channelEntries,
  };

  mkdirSync(STATE_DIR, { recursive: true });
  mkdirSync(join(STATE_DIR, "workspace-main"), { recursive: true });
  writeFileSync(join(STATE_DIR, "openclaw.json"), JSON.stringify(config, null, 2));
  if (ids.includes("router")) {
    if (!ids.includes("gotify")) throw new Error("router E2E requires --plugins router,gotify");
    const routerDir = join(STATE_DIR, "router");
    mkdirSync(routerDir, { recursive: true });
    const now = Date.now();
    const id = `router-e2e-${now}`;
    writeFileSync(join(routerDir, "delivery-state.json"), JSON.stringify({
      version: 1,
      pending: {
        [id]: {
          id,
          dedupeKey: id,
          ruleId: "e2e-persisted-outbox",
          actionType: "forward",
          payload: {
            channel: "gotify",
            to: "e2e",
            content: "router public channel outbound adapter E2E",
            metadata: { idempotencyKey: id },
          },
          attempts: 0,
          createdAt: now,
          nextAttemptAt: now,
        },
      },
      delivered: {},
      deadLetters: [],
      audit: [],
    }, null, 2));
  }
  writeFileSync(join(E2E_DIR, ".e2e-config-meta.json"), JSON.stringify({ rocketmqTopic: e2eTopic, plugins: ids }, null, 2));
  console.log("[config] wrote %s (gateway:%s, plugins:%s)", join(STATE_DIR, "openclaw.json"), GATEWAY_PORT, ids.join(","));
  return { config, meta: { rocketmqTopic: e2eTopic } };
}
