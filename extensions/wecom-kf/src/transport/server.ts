/**
 * @fileoverview 企业微信客服加密 Webhook 传输层的稳定公共出口。
 *
 * 回调验签、解密、事件消费和账号状态补丁位于 `webhook/callback.ts`；本 facade 保留基础
 * Profile 所需的固定导入路径。
 */
export {
  createKfCallbackHandler,
  consumeAccountStatePatch,
  startKfCallbackProcessing,
  stopKfCallbackProcessing,
} from "../webhook/callback.js";
