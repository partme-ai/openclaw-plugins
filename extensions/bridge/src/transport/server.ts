/**
 * Bridge MQ 传输层 — 消息桥接与 trace 工具入口。
 */

export { deriveTraceId, generateMessageId, buildMessage, registerMessageBridge } from "../bridge/message-bridge.js";
export type { UnifiedMessage } from "../bridge/message-bridge.js";
