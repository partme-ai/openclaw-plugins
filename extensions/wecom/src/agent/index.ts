/**
 * @module agent
 *
 * 企业微信 **Agent 模式** 子模块统一导出。
 *
 * **子模块**：
 * - `handler` / `webhook`：XML 回调入站与业务处理
 * - `api-client`：AccessToken 与 message/send API
 * - `asr` / `voice-transcode` / `stream` / `welcome`：能力扩展
 */

export { handleAgentWebhook, type AgentWebhookParams } from "./handler.js";
export {
    getAccessToken,
    sendText,
    uploadMedia,
    sendMedia,
    downloadMedia,
} from "./api-client.js";
