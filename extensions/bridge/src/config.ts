/**
 * Bridge 配置与预设 — Base Profile 入口。
 */

export { PRESETS } from "./bridge/presets.js";

/** Bridge 插件 per-channel 配置项。 */
export interface BridgeChannelConfig {
  enabled?: boolean;
  forwardToMq?: boolean;
  mqChannel?: string;
  contextInjection?: boolean;
}

/** Bridge 插件根配置（openclaw.plugin.json configSchema 对应结构）。 */
export interface BridgePluginConfig {
  channels?: Record<string, BridgeChannelConfig>;
}
