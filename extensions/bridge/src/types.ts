/**
 * @fileoverview Bridge 插件的类型聚合再导出（仅类型，零运行时）。
 *
 * @description
 * 集中暴露下游 TypeScript 工程最常引用的类型符号，避免消费方从多个深层路径串联 import；
 * 与 `config.ts` / `bridge/*` 中的实际定义保持一对一映射。
 *
 * @module types
 */

/**
 * Bridge 共享类型 — Base Profile 入口。
 */

/** @description 渠道元数据与上下文预设键类型。 */
export type { ChannelMeta, ChannelContextPreset } from "./bridge/channels.js";
/** @description 渠道能力矩阵相关类型别名。 */
export type {
  ChannelCapabilities,
  SupportedFormat,
  MediaKind,
  MarkdownDialect,
  OverflowStrategy,
} from "./bridge/capabilities.js";
/** @description 出站规范化结果与策略函数类型。 */
export type { NormalizedMessage, ChannelNormalizer } from "./bridge/normalize.js";
/** @description MQ 统一消息信封类型。 */
export type { UnifiedMessage } from "./bridge/message-bridge.js";
/** @description 插件配置形状（与 `configSchema` 对齐）。 */
export type { BridgeChannelConfig, BridgePluginConfig } from "./config.js";
