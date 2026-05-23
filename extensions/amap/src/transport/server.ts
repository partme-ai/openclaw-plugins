/**
 * HTTP Webhook 传输入口。
 */

export { createAmapWebhookHandler } from "../inbound.js";

/** Gateway 注册的默认 Webhook 路径 */
export const AMAP_WEBHOOK_PATH = "/channels/amap/webhook";
