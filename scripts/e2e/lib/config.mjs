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
function readInstalledIds() {
  const path = join(STATE_DIR, ".e2e-installed.json");
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, "utf8")).map((p) => p.id);
}

/**
 * @param {string[]|undefined} pluginIds
 * @param {{ gotifySecrets?: Record<string, unknown> }} [opts]
 */
export function generateOpenClawConfig(pluginIds, opts = {}) {
  const ids = resolvePlugins(pluginIds);
  const installedIds = readInstalledIds();
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
    plugins: { entries: fragments.pluginEntries },
    channels: fragments.channelEntries,
  };

  mkdirSync(STATE_DIR, { recursive: true });
  mkdirSync(join(STATE_DIR, "workspace-main"), { recursive: true });
  writeFileSync(join(STATE_DIR, "openclaw.json"), JSON.stringify(config, null, 2));
  writeFileSync(join(E2E_DIR, ".e2e-config-meta.json"), JSON.stringify({ rocketmqTopic: e2eTopic, plugins: ids }, null, 2));
  console.log("[config] wrote %s (gateway:%s, plugins:%s)", join(STATE_DIR, "openclaw.json"), GATEWAY_PORT, ids.join(","));
  return { config, meta: { rocketmqTopic: e2eTopic } };
}
