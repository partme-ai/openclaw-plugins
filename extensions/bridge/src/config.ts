/**
 * @fileoverview Bridge 插件配置形状与上下文预设导出。
 *
 * @description
 * `BridgePluginConfig` 与宿主 `openclaw.plugin.json` 中 `configSchema` 对齐；`PRESETS`
 * 为各 IM 渠道的 `before_prompt_build` 系统补全文案。本文件是 Base Profile 下「配置 +
 * 预设」的稳定入口。
 *
 * @module config
 */

/**
 * Bridge 配置与预设 — Base Profile 入口。
 */

/** @description 各渠道 `before_prompt_build` 系统上下文全文映射。 */
export { PRESETS } from "./bridge/presets.js";

/**
 * @description 单渠道的 Bridge 行为开关：是否启用、是否转发 MQ、目标 MQ 通道名、是否注入上下文。
 */
export interface BridgeChannelConfig {
  /** @description 为 `false` 时该渠道相关钩子短路（与同文件 Hook 判定一致）。 */
  enabled?: boolean;
  /** @description 为 `false` 时跳过 `agent_end` 侧 MQ 桥接。 */
  forwardToMq?: boolean;
  /** @description 选用的消息中间件别名（须落在 message-bridge 的白名单内才会原样生效）。 */
  mqChannel?: string;
  /** @description 为 `false` 时跳过 `before_prompt_build` 的上下文追加。 */
  contextInjection?: boolean;
}

/**
 * @description Bridge 插件根配置：按键为渠道 ID（如 `discord`、`wecom`），值为该渠道的细粒度选项。
 */
export interface BridgePluginConfig {
  /** @description 可选的渠道级配置表；缺省时各 Hook 内部按「未配置则不处理或默认开启」解释。 */
  channels?: Record<string, BridgeChannelConfig>;
}
