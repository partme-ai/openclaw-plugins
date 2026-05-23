/**
 * WeCom 入站横切：DM 策略、msgid 去重。
 */

export { checkDmPolicy, type DmPolicyCheckResult } from "./dm-policy.js";
export {
  claimWecomInboundMsgid,
  warmupWecomWebhookDedupe,
  resetWecomWebhookDedupeForTests,
} from "./webhook/dedup.js";
