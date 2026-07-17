/**
 * Load and merge per-plugin OpenClaw config fragments.
 */
import { mqttConfig } from "./mqtt.mjs";
import { rabbitmqConfig } from "./rabbitmq.mjs";
import { redisStreamConfig } from "./redis-stream.mjs";
import { rocketmqConfig } from "./rocketmq.mjs";
import { gotifyConfig } from "./gotify.mjs";
import { stompConfig } from "./stomp.mjs";
import { webMqttConfig } from "./web-mqtt.mjs";
import { webStompConfig } from "./web-stomp.mjs";
import { routerConfig } from "./router.mjs";
import { mtlsConfig } from "./mtls.mjs";
import { oauth2Config } from "./oauth2.mjs";
import { webSocketConfig } from "./web-socket.mjs";
import { tracingConfig } from "./tracing.mjs";
import { prometheusConfig } from "./prometheus.mjs";
import { memoryConfig } from "./memory.mjs";
import { openmemConfig } from "./openmem.mjs";
import { knowledgeConfig } from "./knowledge.mjs";
import { douyinConfig } from "./douyin.mjs";
import { amapConfig } from "./amap.mjs";
import { meituanConfig } from "./meituan.mjs";
import { rednodeConfig } from "./rednode.mjs";
import { wechatConfig } from "./wechat.mjs";
import { wechatIpadConfig } from "./wechat-ipad.mjs";
import { wecomKfConfig } from "./wecom-kf.mjs";
import { wecomConfig } from "./wecom.mjs";
import { bridgeConfig } from "./bridge.mjs";
import { nacosConfig } from "./nacos.mjs";

/** @type {Record<string, (ctx: import('./mqtt.mjs').ConfigContext) => { pluginEntry: Record<string, unknown>; channelEntry: Record<string, unknown> }>} */
const BUILDERS = {
  mqtt: mqttConfig,
  rabbitmq: rabbitmqConfig,
  "redis-stream": redisStreamConfig,
  rocketmq: rocketmqConfig,
  gotify: gotifyConfig,
  stomp: stompConfig,
  "web-mqtt": webMqttConfig,
  "web-stomp": webStompConfig,
  router: routerConfig,
  mtls: mtlsConfig,
  oauth2: oauth2Config,
  "web-socket": webSocketConfig,
  tracing: tracingConfig,
  prometheus: prometheusConfig,
  memory: memoryConfig,
  openmem: openmemConfig,
  knowledge: knowledgeConfig,
  douyin: douyinConfig,
  amap: amapConfig,
  meituan: meituanConfig,
  rednode: rednodeConfig,
  wechat: wechatConfig,
  "wechat-ipad": wechatIpadConfig,
  "wecom-kf": wecomKfConfig,
  wecom: wecomConfig,
  bridge: bridgeConfig,
  nacos: nacosConfig,
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
  /** @type {Record<string, string>} */
  const pluginSlots = {};

  for (const id of pluginIds) {
    const build = BUILDERS[id];
    if (!build) throw new Error(`No config builder for plugin: ${id}`);
    const { pluginEntry, channelEntry, pluginSlots: slots = {} } = build(ctx);
    Object.assign(pluginEntries, pluginEntry);
    Object.assign(channelEntries, channelEntry);
    for (const [slot, owner] of Object.entries(slots)) {
      if (pluginSlots[slot] && pluginSlots[slot] !== owner) {
        throw new Error(`Conflicting plugin slot ${slot}: ${pluginSlots[slot]} vs ${owner}`);
      }
      pluginSlots[slot] = owner;
    }
  }

  return { pluginEntries, channelEntries, pluginSlots };
}

/**
 * Register a new plugin config builder (for future adapters).
 * @param {string} id
 * @param {typeof mqttConfig} builder
 */
export function registerConfigBuilder(id, builder) {
  BUILDERS[id] = builder;
}
