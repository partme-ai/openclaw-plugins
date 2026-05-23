/**
 * HTTP Webhook 传输入口。
 */

export { createXhsWebhookHandler, verifyXhsWebhook } from "../inbound.js";

export const XHS_WEBHOOK_PATH = "/channels/xhs/webhook";
