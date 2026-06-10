/**
 * 微信入站 — Base Profile 入口，语义实现位于 messaging/inbound。
 */

export {
  restoreContextTokens,
  clearContextTokensForAccount,
  setContextToken,
  getContextToken,
  findAccountIdsByContextToken,
  weixinMessageToMsgContext,
  getContextTokenFromMsgContext,
  isMediaItem,
} from "./messaging/inbound.js";
export type { WeixinMsgContext, WeixinInboundMediaOpts } from "./messaging/inbound.js";
