/**
 * @module dedup
 *
 * 入站消息幂等、持久化去重与 claim/commit/release 并发保护的 barrel export。
 *
 * **职责**：为 RabbitMQ / RocketMQ / Webhook replay 等场景提供内存 TTL 幂等、
 * 磁盘 JSON 持久化去重，以及「先 claim 再 commit/release」的入站处理锁语义。
 *
 * **适用场景**：MQ 消费者 at-least-once 投递、Webhook 重放防护、跨进程重启后的重复消息过滤。
 *
 * **关键导出**：
 * - `createIdempotencyCache` — 单进程内存 TTL 幂等缓存
 * - `createPersistentDedupe` — OpenClaw SDK 优先的持久化去重（fallback 本地 JSON）
 * - `createClaimableDedupe` — claim → commit/release 的可抢占去重
 */

export * from "./idempotency-cache.js";
export * from "./persistent-dedupe.js";
export * from "./claimable-dedupe.js";
