/**
 * HTTP Webhook 传输入口（Transport Layer）
 *
 * **架构角色**：对外暴露 Webhook 相关符号，供插件入口（`index.ts`）注册 HTTP 路由。
 * 实际请求处理逻辑在 `../inbound.ts`。
 *
 * **关键依赖**：`../inbound` — Webhook 处理器工厂
 */

export { createAmapWebhookHandler } from "../inbound.js";

/** Gateway 注册的默认 Webhook 路径（POST 入站）。 */
export const AMAP_WEBHOOK_PATH = "/channels/amap/webhook";
