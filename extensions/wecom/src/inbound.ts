/**
 * @module inbound
 *
 * WeCom 入站 **横切导出**（DM 策略 + msgid 持久化 dedup）。
 *
 * **持久化 dedup**（`webhook/dedup.ts`）：
 * - 基于 message-sdk `createPersistentDedupe`，内存 + 磁盘 JSON
 * - TTL 24h；Bot 与 Agent 使用不同 namespace 隔离
 * - `claimWecom*Msgid` 返回 true 表示首次 claim，false 表示重复应跳过
 *
 * **关键导出**：`checkDmPolicy`、`claimWecomInboundMsgid`、`claimWecomAgentInboundMsgid`
 */

export { checkDmPolicy, type DmPolicyCheckResult } from "./config/dm-policy.js";
export {
  claimWecomInboundMsgid,
  claimWecomAgentInboundMsgid,
  warmupWecomWebhookDedupe,
  resetWecomWebhookDedupeForTests,
} from "./webhook/dedup.js";
