/**
 * @partme.ai/wecom_kf 插件入口
 *
 * 企业微信客服渠道插件 — 对接企微微信客服 API，
 * 让 OpenClaw Agent 伪装为客服坐席，实现 7x24 智能客服。
 *
 * NOTE: This file is a stub - the actual plugin implementation is in the root index.ts
 * This src/index.ts is kept for compatibility but the main entry point is now root index.ts
 */

// Re-export types and core functions for external use
export * from "./types/index.js";
export { handleAgentWebhook } from "./agent/index.js";
export { getAccessToken, sendText, uploadMedia, sendMedia, downloadMedia } from "./agent/api-client.js";