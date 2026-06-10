/**
 * @module mcp
 *
 * 企业微信 **MCP（Model Context Protocol）** 集成模块。
 *
 * **职责**：
 * - `tool`：Agent Tool `wecom_mcp`（list/call）
 * - `transport`：Streamable HTTP JSON-RPC、session 生命周期、配置缓存
 * - `interceptors`：call 前后管道（业务错误、文档授权、媒体 base64、本地文件等）
 * - `schema`：Gemini 兼容的 inputSchema 清洗
 *
 * **拦截器职责概览**见 `mcp/interceptors/index.ts`。
 */

export { createWeComMcpTool } from "./tool.js";
export { sendJsonRpc, clearCategoryCache, clearAccountCache, resolveCurrentAccountId, McpRpcError, McpHttpError, type McpToolInfo } from "./transport.js";
export { cleanSchemaForGemini } from "./schema.js";
// 注意：parseSessionKeyChat 已废弃不再导出。
//   OpenClaw core 构建 sessionKey 时会把 chatId 小写化，
//   企业微信接口（如 aibot_send_biz_msg）是大小写敏感的，反解结果不可用。
//   chatId 请通过 state-manager 的 getSessionChatInfo(sessionKey) 获取。
