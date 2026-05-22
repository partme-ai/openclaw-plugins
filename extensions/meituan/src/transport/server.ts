/**
 * HTTP Webhook 传输入口。
 */

export { createMeituanWebhookHandler, verifyMeituanWebhook } from "../inbound.js";

export const MEITUAN_WEBHOOK_PATH = "/channels/meituan/webhook";
