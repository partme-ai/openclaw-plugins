/**
 * WeCom 传输层 barrel（transport/server）
 *
 * 根级 HTTP / 网关生命周期 re-export，供 index.ts 注册路由：
 * - Bot Webhook 处理与 gateway 启停 → webhook/*
 * - Agent XML Webhook 工厂 → agent/webhook
 *
 * 具体加解密与 message-sdk 入站管线在 webhook/、agent/ 子目录实现。
 */

export {
  handleWecomWebhookRequest,
  registerWecomWebhookTarget,
  startWebhookGateway,
  stopWebhookGateway,
  getMonitorState,
} from "../webhook/index.js";

export { createWecomAgentWebhookHandler } from "../agent/webhook.js";
