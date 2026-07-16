/**
 * @fileoverview 企业微信客服入站分发的稳定公共出口。
 *
 * 完整实现位于 `dispatch/inbound-dispatcher.ts`，涵盖回调消息校验、会话路由和 Agent 分发；
 * 本 facade 仅保持基础 Profile 与历史导入路径兼容。
 */
export {
  dispatchKfMessage,
  handleCustomerMessage,
} from "./dispatch/inbound-dispatcher.js";
