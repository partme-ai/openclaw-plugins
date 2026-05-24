/**
 * @file Gotify Channel Barrel — ChannelPlugin 表面再导出。
 *
 * @description 将 `channel/channel.ts` 中导出的生命周期 / 派发核心符号统一对外暴露，
 * 供 `setup-entry.ts`、`index.ts` 等上层模块以稳定路径导入，而无需知晓内部层级拆分。
 * **模块角色**：Channel Plugin · Public facade（thin barrel）。
 */

export {
  cleanupGotifyChannel,
  dispatchInboundMessage,
  gotifyChannel,
} from "./channel/channel.js";
