/**
 * @fileoverview 企业微信客服出站适配器的稳定公共出口。
 *
 * 实际实现位于 `outbound/index.ts`，负责被动回复、主动消息与媒体发送；本 facade 保持基础
 * Profile 和历史导入路径兼容。
 */
export { wecomOutbound } from "./outbound/index.js";
