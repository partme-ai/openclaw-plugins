/**
 * index.ts — 消息队列、按 key 串行运行队列与入站防抖缓冲。
 *
 * 本文件作为 queue 模块的一部分，负责对外暴露稳定 API 或组织子模块出口；注释用于说明职责边界，避免通道插件重复实现同类逻辑。
 */

export * from "./inbound-message-queue.js";
export * from "./outbound-message-queue.js";
export * from "./keyed-run-queue.js";
export * from "./inbound-debounce-buffer.js";
