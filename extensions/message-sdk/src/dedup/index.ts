/**
 * index.ts — 入站消息幂等、持久化去重与并发 claim/release 保护。
 *
 * 本文件作为 dedup 模块的一部分，负责对外暴露稳定 API 或组织子模块出口；注释用于说明职责边界，避免通道插件重复实现同类逻辑。
 */

export * from "./idempotency-cache.js";
export * from "./persistent-dedupe.js";
export * from "./claimable-dedupe.js";
