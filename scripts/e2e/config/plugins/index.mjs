/**
 * Load and merge per-plugin OpenClaw config fragments.
 */
import { mqttConfig } from "./mqtt.mjs";
import { rabbitmqConfig } from "./rabbitmq.mjs";
import { rocketmqConfig } from "./rocketmq.mjs";
import { gotifyConfig } from "./gotify.mjs";
import { stompConfig } from "./stomp.mjs";
import { webMqttConfig } from "./web-mqtt.mjs";
import { webStompConfig } from "./web-stomp.mjs";

/** @type {Record<string, (ctx: import('./mqtt.mjs').ConfigContext) => { pluginEntry: Record<string, unknown>; channelEntry: Record<string, unknown> }>} */
const BUILDERS = {
  mqtt: mqttConfig,
  rabbitmq: rabbitmqConfig,
  rocketmq: rocketmqConfig,
  gotify: gotifyConfig,
  stomp: stompConfig,
  "web-mqtt": webMqttConfig,
  "web-stomp": webStompConfig,
};

/**
 * @param {string[]} pluginIds
 * @param {import('./mqtt.mjs').ConfigContext} ctx
 */
export function loadPluginConfigs(pluginIds, ctx) {
  /** @type {Record<string, unknown>} */
  const pluginEntries = {};
  /** @type {Record<string, unknown>} */
  const channelEntries = {};

  for (const id of pluginIds) {
    const build = BUILDERS[id];
    if (!build) throw new Error(`No config builder for plugin: ${id}`);
    const { pluginEntry, channelEntry } = build(ctx);
    Object.assign(pluginEntries, pluginEntry);
    Object.assign(channelEntries, channelEntry);
  }

  return { pluginEntries, channelEntries };
}

/**
 * Register a new plugin config builder (for future adapters).
 * @param {string} id
 * @param {typeof mqttConfig} builder
 */
export function registerConfigBuilder(id, builder) {
  BUILDERS[id] = builder;
}
