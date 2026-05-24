/**
 * Plugin registry for OpenClaw E2E — metadata used by install, config, compose, and test adapters.
 * @typedef {'embedded-service'|'external-broker'|'web-browser'|'webhook-platform'|'infra'} PluginCategory
 */

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
 * Resolve plugin ids from CLI/env; default = all queue/channel plugins.
 * @param {string[]|undefined} requested
 */
export function resolvePlugins(requested) {
  const all = PLUGIN_REGISTRY.map((p) => p.id);
  if (!requested?.length) return all;
  const unknown = requested.filter((id) => !all.includes(id));
  if (unknown.length) {
    throw new Error(`Unknown plugin id(s): ${unknown.join(", ")}. Known: ${all.join(", ")}`);
  }
  return requested;
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
