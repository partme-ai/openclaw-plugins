/**
 * @module webhook/index
 *
 * Webhook 模块公共入口 — 企微 Bot **HTTP 回调**模式对外 re-export。
 *
 * **职责**：聚合 handler、gateway、target、state、types 的公共 API，供插件主入口注册 HTTP 路由。
 *
 * **与 message-sdk 关系**：
 * - 底层队列/去重/ActiveReply 依赖 message-sdk `queue`、`ingress` 子模块（见 `state.ts`）
 * - 入站 body 限流对齐 message-sdk webhook-ingress（`readRequestBodyWithLimit`）
 *
 * **关键流程**：`startWebhookGateway` → 注册 Target → `handleWecomWebhookRequest` → monitor 层
 *
 * **关键导出**：`handleWecomWebhookRequest`、`startWebhookGateway`、`registerWecomWebhookTarget`、
 * 各类 Webhook 类型与 TTL 常量
 */

// ── Handler ─────────────────────────────────────────────────────────
export { handleWecomWebhookRequest } from "./handler.js";

// ── Target ──────────────────────────────────────────────────────────
export {
  registerWecomWebhookTarget,
  getRegisteredTargets,
  getWebhookTargetsMap,
  hasActiveTargets,
  parseWebhookPath,
} from "./target.js";

// ── Gateway ─────────────────────────────────────────────────────────
export { startWebhookGateway, stopWebhookGateway, getMonitorState } from "./gateway.js";

// ── Types ───────────────────────────────────────────────────────────
export type {
  WecomWebhookTarget,
  WebhookGatewayContext,
  ResolvedWebhookAccount,
  WebhookAccountConfig,
  WecomRuntimeEnv,
  StreamState,
  PendingInbound,
  ActiveReplyState,
  WebhookInboundMessage,
} from "./types.js";

export {
  STREAM_TTL_MS,
  ACTIVE_REPLY_TTL_MS,
  DEFAULT_DEBOUNCE_MS,
  STREAM_MAX_BYTES,
  BOT_WINDOW_MS,
  BOT_SWITCH_MARGIN_MS,
  REQUEST_TIMEOUT_MS,
  PRUNE_INTERVAL_MS,
  WEBHOOK_PATHS,
} from "./types.js";

// ── State (全局单例) ────────────────────────────────────────────────
export { monitorState, WebhookMonitorState } from "./state.js";
