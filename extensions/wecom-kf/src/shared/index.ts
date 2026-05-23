/**
 * WeCom Shared 模块导出
 */

export { parseXml, extractMsgType, extractFromUser, extractContent, extractChatId, extractToUser } from "./xml-parser.js";
export { wecomFetch, readResponseBodyAsBuffer, withTimeout, TimeoutError, type WecomHttpOptions } from "./http.js";
