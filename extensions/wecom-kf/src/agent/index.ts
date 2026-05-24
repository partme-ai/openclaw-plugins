/**
 * @module wecom-kf/agent
 *
 * 企业微信 KF **Agent 模式** 子模块统一导出。
 *
 * **子模块**：
 * - `handler`：KF 客户消息 Agent 调度与回复投递
 * - `api-client`：KF AccessToken 与 send/sync API
 * - `kf-send-guard` / `system-event` / `asr` / `voice-transcode`：会话守卫与能力扩展
 *
 * **关键导出**：`handleAgentWebhook`、媒体与文本发送 API
 */

export { handleAgentWebhook } from "./handler.js";
export {
  getAccessToken,
  sendText,
  uploadMedia,
  sendMedia,
  downloadMedia,
} from "./api-client.js";
