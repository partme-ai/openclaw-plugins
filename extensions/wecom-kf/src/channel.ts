/**
 * @fileoverview 企业微信客服 Channel 的稳定公共出口。
 *
 * 完整 OpenClaw Channel 契约位于 `channel/channel.ts`；此 facade 保留旧导入路径，避免目录
 * 重组影响插件入口和外部测试。
 */
export { wecomPlugin } from "./channel/channel.js";
