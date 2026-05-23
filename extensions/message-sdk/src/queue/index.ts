/**
 * @module queue
 *
 * 消息队列、按 key 串行运行队列、入站防抖缓冲与流式会话存储的 barrel export。
 *
 * **职责**：对外暴露 queue 子模块的稳定 API，避免各 IM 通道插件重复实现 FIFO 入站/出站、
 * 会话级串行、burst 防抖与 stream 批次排队逻辑。
 *
 * **适用场景**：WeCom / Feishu 等插件在 Gateway 进程内缓冲消息、按 chatId 串行 Agent 运行、
 * 或管理流式回复的 debounce 与 per-conversation 批次队列。
 *
 * **关键导出**：
 * - `InboundMessageQueue` / `OutboundMessageQueue` — 单进程 FIFO 入站/出站队列
 * - `createKeyedRunQueue` — 同 key 串行、跨 key 并行任务队列
 * - `createInboundDebounceBuffer` — 按会话 key 的入站 burst 防抖合并
 * - `StreamSessionStore` / `StreamSessionMonitor` — 流式会话状态、msgid 去重与批次排队
 */

export * from "./inbound-message-queue.js";
export * from "./outbound-message-queue.js";
export * from "./keyed-run-queue.js";
export * from "./inbound-debounce-buffer.js";
export * from "./stream-session-store.js";
