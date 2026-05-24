/**
 * @fileoverview Rednode HTTP Webhook 传输入口：路径常量与 inbound 再导出。
 *
 * @description
 * 固定 Webhook 路径 `/channels/xhs/webhook`；验签与 dispatch 逻辑位于 inbound 模块，
 * 本文件供 index 注册路由时引用稳定符号。
 *
 * @module transport/server
 */

/**
 * Rednode Webhook 传输层 — 路径与 handler 门面。
 */

/** @description 小红书 Webhook 验签与处理器（再导出）。 */
export { createXhsWebhookHandler, verifyXhsWebhook } from "../inbound.js";

/** @description 小红书 Webhook 固定路径（相对 Gateway HTTP 根）。 */
export const XHS_WEBHOOK_PATH = "/channels/xhs/webhook";
