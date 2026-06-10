/**
 * @module inbound
 *
 * WeCom 入站 **横切导出**（msgid 持久化 dedup）。
 *
 * **持久化 dedup**（`webhook/dedup.ts`）：
 * - 基于 message-sdk `createPersistentDedupe`，内存 + 磁盘 JSON
 * - TTL 24h；Bot 与 Agent 使用不同 namespace 隔离
 * - `claimWecom*Msgid` 返回 true 表示首次 claim，false 表示重复应跳过
 *
 * DM 策略见 `config/dm-policy.ts`；本模块仅导出 webhook 入站 dedup。
 */

export {
  claimWecomInboundMsgid,
  claimWecomAgentInboundMsgid,
  warmupWecomWebhookDedupe,
  resetWecomWebhookDedupeForTests,
} from "./webhook/dedup.js";
