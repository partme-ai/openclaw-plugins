/**
 * Plugin E2E adapter registry and runner.
 */
import { createTestContext } from "./_context.mjs";
import { testMqtt } from "./mqtt.mjs";
import { testRabbitmq } from "./rabbitmq.mjs";
import { testRocketmq } from "./rocketmq.mjs";
import { testGotify } from "./gotify.mjs";
import { testStomp } from "./stomp.mjs";
import { testWebMqtt } from "./web-mqtt.mjs";
import { testWebStomp } from "./web-stomp.mjs";
import { resolvePlugins } from "../lib/registry.mjs";

/** @type {Record<string, (ctx: ReturnType<typeof createTestContext>, results: import('../lib/utils.mjs').resultRow[]) => Promise<void>>} */
const ADAPTERS = {
  mqtt: testMqtt,
  rabbitmq: testRabbitmq,
  rocketmq: testRocketmq,
  gotify: testGotify,
  stomp: testStomp,
  "web-mqtt": testWebMqtt,
  "web-stomp": testWebStomp,
};

/**
 * Register a plugin test adapter for extension.
 * @param {string} id
 * @param {typeof testMqtt} fn
 */
export function registerAdapter(id, fn) {
  ADAPTERS[id] = fn;
}

/** @type {import('../lib/utils.mjs').resultRow[]} */
export const results = [];

/**
 * Run installed-plugin smoke tests for selected plugins.
 * @param {string[]|undefined} pluginIds
 */
export async function runPluginTests(pluginIds) {
  const ids = resolvePlugins(pluginIds);
  results.length = 0;
  const ctx = createTestContext(ids);

  for (const id of ids) {
    const adapter = ADAPTERS[id];
    if (!adapter) throw new Error(`No E2E adapter for plugin: ${id}`);
    await adapter(ctx, results);
  }

  return results;
}

/** Back-compat alias used by legacy import. */
export async function runAllPluginTests(pluginIds) {
  return runPluginTests(pluginIds);
}

export { runBrowserTests, browserResults } from "../browser-web-channels.mjs";
