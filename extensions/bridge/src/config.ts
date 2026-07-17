/** Bridge 配置公共入口：预设与严格校验均由 Extended Profile 的实现提供。 */
export { PRESETS } from "./bridge/presets.js";
export { validateBridgeConfig } from "./bridge/message-bridge.js";
export type { BridgeConfig, BridgeChannelConfig } from "./bridge/message-bridge.js";
