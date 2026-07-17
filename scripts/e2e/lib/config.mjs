/**
 * Merge per-plugin config fragments into ~/.openclaw-queue-e2e/openclaw.json.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { loadPluginConfigs } from "../config/plugins/index.mjs";
import { PLUGIN_REGISTRY, resolvePlugins } from "./registry.mjs";
import { E2E_DIR, E2E_PORTS, GATEWAY_PORT, STATE_DIR } from "./utils.mjs";

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
  const manifestIdFor = (id) => PLUGIN_REGISTRY.find((plugin) => plugin.id === id)?.manifestId ?? id;
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
    fragments.pluginEntries[manifestIdFor(installedId)] = { enabled: false };
  }

  /** Ensure registry-known plugins not installed are not referenced. */
  for (const def of PLUGIN_REGISTRY) {
    if (!ids.includes(def.id) && !installedIds.includes(def.id)) {
      delete fragments.pluginEntries[def.manifestId ?? def.id];
    }
  }

  const config = {
    gateway: {
      mode: "local",
      port: GATEWAY_PORT,
      bind: "loopback",
      ...(ids.includes("mtls") || ids.includes("oauth2") ? {
        trustedProxies: ["127.0.0.1"],
        auth: {
          mode: "trusted-proxy",
          trustedProxy: {
            allowLoopback: true,
            userHeader: "x-forwarded-user",
            allowUsers: [ids.includes("oauth2") ? "oauth-e2e-user" : "e2e-client"],
          },
        },
      } : { auth: { mode: "none" } }),
    },
    session: { dmScope: "main" },
    plugins: {
      allow: ids.map(manifestIdFor),
      ...(Object.keys(fragments.pluginSlots).length > 0 ? { slots: fragments.pluginSlots } : {}),
      // OpenClaw profiles can inherit managed npm projects from the host. Keep
      // this run's freshly packed paths explicit so an older published package
      // cannot win schema validation or runtime loading.
      load: {
        paths: installed
          .filter((plugin) => ids.includes(plugin.id))
          .map((plugin) => plugin.path),
      },
      entries: fragments.pluginEntries,
    },
    channels: fragments.channelEntries,
    ...(ids.some((id) =>
      id === "mqtt" || id === "tracing" || id === "rabbitmq" || id === "redis-stream" || id === "rocketmq" || id === "gotify" || id === "stomp" || id === "web-stomp" || id === "web-mqtt" || id === "web-socket" || id === "memory" || id === "openmem" || id === "knowledge" || id === "douyin" || id === "amap" || id === "meituan" || id === "rednode" || id === "wechat" || id === "wechat-ipad" || id === "wecom" || id === "wecom-kf" || id === "bridge"
    ) ? {
      models: {
        mode: "replace",
        providers: {
          "e2e-fixture": {
            baseUrl: `http://127.0.0.1:${E2E_PORTS.modelFixture}/v1`,
            apiKey: "openclaw-e2e-model-key",
            api: "openai-completions",
            models: [{
              id: "fixture-model",
              name: "OpenClaw E2E Fixture Model",
              reasoning: false,
              input: ["text"],
              // OpenClaw injects its production system prompt even for this
              // controlled fixture. Keep the declared window realistic enough
              // to exercise the provider call instead of tripping the local
              // preflight context guard.
              contextWindow: 131072,
              maxTokens: 1024,
              compat: { supportsTools: ids.includes("amap") || ids.includes("meituan") || ids.includes("rednode"), requiresStringContent: true },
            }],
          },
        },
      },
      agents: {
        defaults: {
          model: { primary: "e2e-fixture/fixture-model" },
          // Force the built-in harness. A host with Codex credentials can make
          // OpenClaw's implicit `auto` policy select the Codex harness, which
          // then substitutes an OpenAI model and defeats this isolated fixture.
          models: {
            "e2e-fixture/fixture-model": { agentRuntime: { id: "openclaw" } },
          },
          timeoutSeconds: 60,
        },
      },
    } : {}),
  };

  mkdirSync(STATE_DIR, { recursive: true });
  mkdirSync(join(STATE_DIR, "workspace-main"), { recursive: true });
  const configPath = join(STATE_DIR, "openclaw.json");
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  // The dedicated E2E profile is regenerated from scratch. `plugins install`
  // creates recovery snapshots for the pre-install seed config; keeping those
  // snapshots after the final raw write makes OpenClaw correctly (but
  // undesirably for this harness) restore the older config as suspicious.
  for (const file of readdirSync(STATE_DIR)) {
    if (file === "openclaw.json.bak" || file === "openclaw.json.last-good" || file.startsWith("openclaw.json.clobbered.")) {
      rmSync(join(STATE_DIR, file), { force: true });
    }
  }
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
  if (ids.includes("bridge") && !ids.includes("mqtt")) {
    throw new Error("bridge E2E requires --plugins bridge,mqtt");
  }
  writeFileSync(join(E2E_DIR, ".e2e-config-meta.json"), JSON.stringify({ rocketmqTopic: e2eTopic, plugins: ids }, null, 2));
  console.log("[config] wrote %s (gateway:%s, plugins:%s)", configPath, GATEWAY_PORT, ids.join(","));
  return { config, meta: { rocketmqTopic: e2eTopic } };
}
