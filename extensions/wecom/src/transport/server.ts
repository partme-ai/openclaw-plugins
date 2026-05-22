/**
 * WeCom 传输层入口：Webhook HTTP、Agent webhook、网关生命周期。
 */

export {
  handleWecomWebhookRequest,
  registerWecomWebhookTarget,
  startWebhookGateway,
  stopWebhookGateway,
  getMonitorState,
} from "../webhook/index.js";

export { createWecomAgentWebhookHandler } from "../agent/webhook.js";
