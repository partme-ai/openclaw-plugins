/**
 * Plugin registry for OpenClaw E2E — metadata used by install, config, compose, and test adapters.
 * @typedef {'embedded-service'|'external-broker'|'web-browser'|'webhook-platform'|'infra'|'capability'|'memory'|'sdk'} PluginCategory
 * @typedef {'channel'|'capability'|'infra'|'memory'|'sdk'} ExtensionType
 *
 * @typedef {Object} ExtensionInventoryEntry
 * @property {string} id
 * @property {string} filter - pnpm --filter package name
 * @property {string} dir - path under repo root
 * @property {ExtensionType} type
 * @property {PluginCategory} category
 * @property {boolean} e2eAdapter - has scripts/e2e/plugins/<id>.mjs adapter
 * @property {boolean} dockerRequired - e2e needs Docker backing services
 * @property {string[]} dockerServices
 */

/** Full extension matrix (unit tests for all; e2e only where e2eAdapter=true). */
/** @type {ExtensionInventoryEntry[]} */
export const EXTENSION_INVENTORY = [
  { id: "mqtt", filter: "@partme.ai/openclaw-mqtt", dir: "extensions/mqtt", type: "channel", category: "embedded-service", e2eAdapter: true, dockerRequired: false, dockerServices: [] },
  { id: "stomp", filter: "@partme.ai/openclaw-stomp", dir: "extensions/stomp", type: "channel", category: "embedded-service", e2eAdapter: true, dockerRequired: false, dockerServices: [] },
  { id: "web-mqtt", filter: "@partme.ai/openclaw-web-mqtt", dir: "extensions/web-mqtt", type: "channel", category: "web-browser", e2eAdapter: true, dockerRequired: false, dockerServices: [] },
  { id: "web-stomp", filter: "@partme.ai/openclaw-web-stomp", dir: "extensions/web-stomp", type: "channel", category: "web-browser", e2eAdapter: true, dockerRequired: false, dockerServices: [] },
  { id: "rabbitmq", filter: "@partme.ai/openclaw-rabbitmq", dir: "extensions/rabbitmq", type: "channel", category: "external-broker", e2eAdapter: true, dockerRequired: true, dockerServices: ["rabbitmq"] },
  { id: "rocketmq", filter: "@partme.ai/openclaw-rocketmq", dir: "extensions/rocketmq", type: "channel", category: "external-broker", e2eAdapter: true, dockerRequired: true, dockerServices: ["rocketmq-namesrv", "rocketmq-broker", "rocketmq-proxy"] },
  { id: "gotify", filter: "@partme.ai/openclaw-gotify", dir: "extensions/gotify", type: "channel", category: "external-broker", e2eAdapter: true, dockerRequired: true, dockerServices: ["gotify"] },
  { id: "redis-stream", filter: "@partme.ai/openclaw-redis-stream", dir: "extensions/redis-stream", type: "channel", category: "external-broker", e2eAdapter: false, dockerRequired: true, dockerServices: ["redis"] },
  { id: "wecom", filter: "@partme.ai/wecom", dir: "extensions/wecom", type: "channel", category: "webhook-platform", e2eAdapter: false, dockerRequired: false, dockerServices: [] },
  { id: "wecom-kf", filter: "@partme.ai/wecom-kf", dir: "extensions/wecom-kf", type: "channel", category: "webhook-platform", e2eAdapter: false, dockerRequired: false, dockerServices: [] },
  { id: "wechat", filter: "@partme.ai/weixin", dir: "extensions/wechat", type: "channel", category: "webhook-platform", e2eAdapter: false, dockerRequired: false, dockerServices: [] },
  { id: "wechat-ipad", filter: "@partme.ai/wechat-ipad", dir: "extensions/wechat-ipad", type: "channel", category: "webhook-platform", e2eAdapter: false, dockerRequired: false, dockerServices: [] },
  { id: "douyin", filter: "@partme.ai/openclaw-douyin", dir: "extensions/douyin", type: "channel", category: "webhook-platform", e2eAdapter: false, dockerRequired: false, dockerServices: [] },
  { id: "rednode", filter: "@partme.ai/openclaw-rednode", dir: "extensions/rednode", type: "channel", category: "webhook-platform", e2eAdapter: false, dockerRequired: false, dockerServices: [] },
  { id: "amap", filter: "@partme.ai/openclaw-amap", dir: "extensions/amap", type: "channel", category: "webhook-platform", e2eAdapter: false, dockerRequired: false, dockerServices: [] },
  { id: "meituan", filter: "@partme.ai/openclaw-meituan", dir: "extensions/meituan", type: "channel", category: "webhook-platform", e2eAdapter: false, dockerRequired: false, dockerServices: [] },
  { id: "bridge", filter: "@partme.ai/openclaw-bridge", dir: "extensions/bridge", type: "capability", category: "infra", e2eAdapter: false, dockerRequired: false, dockerServices: [] },
  { id: "cluster", filter: "@partme.ai/openclaw-cluster", dir: "extensions/cluster", type: "infra", category: "infra", e2eAdapter: false, dockerRequired: false, dockerServices: [] },
  { id: "router", filter: "@partme.ai/openclaw-router", dir: "extensions/router", type: "infra", category: "infra", e2eAdapter: false, dockerRequired: false, dockerServices: [] },
  { id: "nacos", filter: "@partme.ai/openclaw-nacos", dir: "extensions/nacos", type: "infra", category: "infra", e2eAdapter: false, dockerRequired: false, dockerServices: [] },
  { id: "mtls", filter: "@partme.ai/openclaw-mtls", dir: "extensions/mtls", type: "infra", category: "infra", e2eAdapter: false, dockerRequired: false, dockerServices: [] },
  { id: "oauth2", filter: "@partme.ai/openclaw-oauth2", dir: "extensions/oauth2", type: "infra", category: "infra", e2eAdapter: false, dockerRequired: false, dockerServices: [] },
  { id: "tracing", filter: "@partme.ai/openclaw-tracing", dir: "extensions/tracing", type: "infra", category: "infra", e2eAdapter: false, dockerRequired: false, dockerServices: [] },
  { id: "prometheus", filter: "@partme.ai/openclaw-prometheus", dir: "extensions/prometheus", type: "infra", category: "infra", e2eAdapter: false, dockerRequired: false, dockerServices: [] },
  { id: "knowledge", filter: "@partme.ai/openclaw-knowledge", dir: "extensions/knowledge", type: "capability", category: "capability", e2eAdapter: false, dockerRequired: false, dockerServices: [] },
  { id: "memory", filter: "@partme.ai/openclaw-memory", dir: "extensions/memory", type: "memory", category: "memory", e2eAdapter: false, dockerRequired: false, dockerServices: [] },
  { id: "openmem", filter: "@partme.ai/openclaw-openmem", dir: "extensions/openmem", type: "memory", category: "memory", e2eAdapter: false, dockerRequired: false, dockerServices: [] },
  { id: "message-sdk", filter: "@partme.ai/openclaw-message-sdk", dir: "extensions/message-sdk", type: "sdk", category: "sdk", e2eAdapter: false, dockerRequired: false, dockerServices: [] },
];

/** E2E-capable queue/channel plugins (subset of EXTENSION_INVENTORY). */
/** @type {import('./registry.mjs').PluginDefinition[]} */
export const PLUGIN_REGISTRY = [
  {
    id: "mqtt",
    category: "embedded-service",
    filter: "@partme.ai/openclaw-mqtt",
    dir: "extensions/mqtt",
    extDir: "openclaw-mqtt",
    channels: ["mqtt"],
    dockerServices: [],
    needsGotify: false,
    browserTest: false,
  },
  {
    id: "rabbitmq",
    category: "external-broker",
    filter: "@partme.ai/openclaw-rabbitmq",
    dir: "extensions/rabbitmq",
    extDir: "openclaw-rabbitmq",
    channels: ["rabbitmq"],
    dockerServices: ["rabbitmq"],
    needsGotify: false,
    browserTest: false,
  },
  {
    id: "rocketmq",
    category: "external-broker",
    filter: "@partme.ai/openclaw-rocketmq",
    dir: "extensions/rocketmq",
    extDir: "openclaw-rocketmq",
    channels: ["rocketmq"],
    dockerServices: ["rocketmq-namesrv", "rocketmq-broker", "rocketmq-proxy"],
    needsGotify: false,
    browserTest: false,
  },
  {
    id: "gotify",
    category: "external-broker",
    filter: "@partme.ai/openclaw-gotify",
    dir: "extensions/gotify",
    extDir: "openclaw-gotify",
    channels: ["gotify"],
    dockerServices: ["gotify"],
    needsGotify: true,
    browserTest: false,
  },
  {
    id: "stomp",
    category: "embedded-service",
    filter: "@partme.ai/openclaw-stomp",
    dir: "extensions/stomp",
    extDir: "openclaw-stomp",
    channels: ["stomp-tcp"],
    dockerServices: [],
    needsGotify: false,
    browserTest: false,
  },
  {
    id: "web-mqtt",
    category: "web-browser",
    filter: "@partme.ai/openclaw-web-mqtt",
    dir: "extensions/web-mqtt",
    extDir: "openclaw-web-mqtt",
    channels: ["mqtt-ws"],
    dockerServices: [],
    needsGotify: false,
    browserTest: true,
  },
  {
    id: "web-stomp",
    category: "web-browser",
    filter: "@partme.ai/openclaw-web-stomp",
    dir: "extensions/web-stomp",
    extDir: "openclaw-web-stomp",
    channels: ["stomp"],
    dockerServices: [],
    needsGotify: false,
    browserTest: true,
  },
];

/** Shared dependency installed before channel plugins. */
export const MESSAGE_SDK = {
  id: "message-sdk",
  filter: "@partme.ai/openclaw-message-sdk",
  dir: "extensions/message-sdk",
  skipChannel: true,
};

/**
 * Resolve extension ids for unit tests; default = all extensions in inventory.
 * @param {string[]|undefined} requested
 */
export function resolveExtensionIds(requested) {
  const all = EXTENSION_INVENTORY.map((e) => e.id);
  if (!requested?.length) return all;
  const unknown = requested.filter((id) => !all.includes(id));
  if (unknown.length) {
    throw new Error(`Unknown extension id(s): ${unknown.join(", ")}. Known: ${all.join(", ")}`);
  }
  return requested;
}

/**
 * Resolve plugin ids from CLI/env; default = all queue/channel plugins with e2e adapters.
 * @param {string[]|undefined} requested
 */
export function resolvePlugins(requested) {
  const all = PLUGIN_REGISTRY.map((p) => p.id);
  if (!requested?.length) return all;
  const unknown = requested.filter((id) => !all.includes(id));
  if (unknown.length) {
    throw new Error(`Unknown plugin id(s): ${unknown.join(", ")}. Known e2e: ${all.join(", ")}`);
  }
  return requested;
}

/**
 * @param {string} id
 */
export function findExtension(id) {
  const entry = EXTENSION_INVENTORY.find((e) => e.id === id);
  if (!entry) throw new Error(`Extension not in inventory: ${id}`);
  return entry;
}

/**
 * @param {string[]} pluginIds
 */
export function dockerServicesForPlugins(pluginIds) {
  const set = new Set();
  for (const def of PLUGIN_REGISTRY) {
    if (!pluginIds.includes(def.id)) continue;
    for (const svc of def.dockerServices) set.add(svc);
  }
  return [...set];
}

/**
 * @param {string} id
 */
export function findPlugin(id) {
  const def = PLUGIN_REGISTRY.find((p) => p.id === id);
  if (!def) throw new Error(`Plugin not in registry: ${id}`);
  return def;
}
