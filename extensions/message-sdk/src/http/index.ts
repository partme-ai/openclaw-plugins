/**
 * @module http
 *
 * HTTP 模块 — 客户端 + 重试 + Webhook 体限制 + SSRF 防护。
 *
 * **职责**：
 * - JSON GET/POST 与指数退避重试
 * - Webhook 请求体大小/超时限制
 * - 带 SSRF 防护的安全 fetch
 *
 * **来源**：openclaw-china packages/shared/src/http/ (MIT License)
 *
 * **关键导出**：`httpGet`、`httpPost`、`withRetry`、`safeFetch`、`readRequestBodyWithLimit`
 */

export * from "./http-client.js";
export * from "./body-limit.js";
export * from "./safe-fetch.js";
export * from "./undici-fetch.js";
