/**
 * 企微客服 Agent 模块导出
 * 与 wecom 插件 agent/index 结构对齐
 */

export { handleCustomerMessage } from "./handler.js";
export { handleSystemEvent } from "./system-event.js";
export {
  getAccessToken,
  syncMessages,
  sendMessage,
  sendEventMessage,
  getServiceState,
  transServiceState,
  listKfAccounts,
  listServicers,
  getContactWayUrl,
} from "./api-client.js";
