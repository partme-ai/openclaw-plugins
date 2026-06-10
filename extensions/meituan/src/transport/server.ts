/**
 * HTTP Webhook 传输入口（路径常量 + handler re-export）。
 *
 * **架构角色**：集中定义 Webhook 路径 `MEITUAN_WEBHOOK_PATH`，并导出
 * `createMeituanWebhookHandler` / `verifyMeituanWebhook` 供 index 与测试引用。
 */

export { createMeituanWebhookHandler, verifyMeituanWebhook } from "../inbound.js";

/** 美团 Webhook 固定路径（由 index registerHttpRoute 注册） */
export const MEITUAN_WEBHOOK_PATH = "/channels/meituan/webhook";
