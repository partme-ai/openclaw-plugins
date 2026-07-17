/**
 * OpenClaw 插件分层命名契约。
 *
 * - 工作区目录、manifest id、运行时插件 id：使用同一个短 kebab-case id。
 * - npm 包名：默认使用 @partme.ai/openclaw-<id>，独立品牌包显式登记。
 * - Channel id：属于外部协议层，可以与插件 id 不同，但必须在 manifest 中声明。
 * - 历史插件 id：仅用于升级文档和迁移检查，不再作为新的 canonical id。
 */

export const PARTME_SCOPE = "@partme.ai";

/** 独立品牌包不会重复添加 openclaw- 前缀。 */
export const STANDALONE_PACKAGE_NAMES = Object.freeze({
  wechat: "@partme.ai/weixin",
  "wechat-ipad": "@partme.ai/wechat-ipad",
  wecom: "@partme.ai/wecom",
  "wecom-kf": "@partme.ai/wecom-kf",
});

/**
 * 已经出现过的历史 manifest id。
 *
 * OpenClaw 2026.7.1 不提供插件 id alias，因此这里不伪装成运行时别名；发布检查
 * 使用该表保证迁移文档覆盖所有已知旧配置键。
 */
export const LEGACY_PLUGIN_IDS = Object.freeze({
  bridge: ["openclaw-bridge"],
  gotify: ["openclaw-gotify"],
  knowledge: ["openclaw-knowledge"],
  mqtt: ["openclaw-mqtt"],
  mtls: ["openclaw-mtls"],
  nacos: ["openclaw-nacos"],
  oauth2: ["openclaw-oauth2"],
  prometheus: ["openclaw-prometheus"],
  rabbitmq: ["openclaw-rabbitmq"],
  "redis-stream": ["openclaw-redis-stream"],
  rednode: ["xhs"],
  rocketmq: ["openclaw-rockermq"],
  stomp: ["openclaw-stomp"],
  tracing: ["openclaw-tracing"],
  "web-mqtt": ["openclaw-web-mqtt"],
  "web-stomp": ["openclaw_web_stomp"],
  wechat: ["openclaw-weixin"],
  "wechat-ipad": ["openclaw_wechat_ipad"],
  "wecom-kf": ["wecom_kf"],
});

export function expectedPackageName(pluginId) {
  return STANDALONE_PACKAGE_NAMES[pluginId] ?? `${PARTME_SCOPE}/openclaw-${pluginId}`;
}

export function isKebabCase(value) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

