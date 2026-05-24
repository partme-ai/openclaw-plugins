/**
 * @fileoverview Bridge MQ 传输层符号再导出（兼容「transport/server」固定路径）。
 *
 * @description
 * 部分构建配置或外部集成约定从 `transport/server` 引用消息桥接注册与 UnifiedMessage
 * 工具函数。本文件不实现新的传输协议，仅转发 `bridge/message-bridge` 的公开 API，
 * 避免重复实现与循环依赖。
 *
 * @module transport/server
 */

/**
 * Bridge MQ 传输层 — 消息桥接与 trace 工具入口。
 */

/**
 * @description 从会话上下文确定性派生 traceId（再导出，供 transport 固定路径引用）。
 * @see {@link ../bridge/message-bridge.js!deriveTraceId}
 */
export { deriveTraceId, generateMessageId, buildMessage, registerMessageBridge } from "../bridge/message-bridge.js";
/** @description UnifiedMessage 类型（MQ 载荷 JSON 形状）。 */
export type { UnifiedMessage } from "../bridge/message-bridge.js";
