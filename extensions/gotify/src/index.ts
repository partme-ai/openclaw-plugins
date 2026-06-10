/**
 * @file @partme.ai/openclaw-gotify — OpenClaw Gotify 渠道插件主入口。
 *
 * @description 以 `defineChannelPluginEntry` 将 **ChannelPlugin**、**运行时注入器**
 * 与 full 模式 HTTP 路由注册到 OpenClaw 插件宿主；再透传对外稳定 API（REST 客户端、错误类型、
 * 路由 mapper、WS factory、bootstrap / config wizard）。
 * **模块角色**：Channel Plugin · Composition root（生命周期装配 + 公共 surface 聚合）。
 *
 * @packageDocumentation
 */

import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";

import { gotifyChannel } from "./channel.js";
import { setGotifyRuntime } from "./runtime.js";
import { registerGotifyFull } from "./runtime/register-full.js";

export { gotifyChannel } from "./channel.js";
export {
  sendGotifyMessage,
  getMessages,
  deleteAllMessages,
  deleteMessage,
  getApplicationMessages,
  deleteApplicationMessages,
  listApplications,
  createApplication,
  updateApplication,
  deleteApplication,
  uploadApplicationImage,
  listClients,
  createClient,
  updateClient,
  deleteClient,
  healthCheck,
  runGotifyDoctor,
  buildMessageRequest,
  normalizeServerUrl,
} from "./transport/gotify-api.js";
export {
  GotifyApiError,
  GotifyConnectionError,
  GotifyConfigError,
  GotifyWebSocketError,
  GotifyTimeoutError,
} from "./shared/errors.js";
export {
  resolveGotifyAccount,
  resolveDefaultGotifyAccountId,
  listGotifyAccountIds,
  describeGotifyAccountSnapshot,
  DEFAULT_GOTIFY_ACCOUNT_ID,
} from "./config.js";
export {
  mapGotifyToInbound,
  mapOutboundToGotify,
} from "./dispatch/routing/message-mapper.js";
export { createGotifyWsListener } from "./transport/server.js";
export { bootstrapGotifyAccount, doctorGotifyAccount } from "./runtime/bootstrap.js";
export { runConfigWizard } from "./config/config-wizard.js";

/**
 * OpenClaw 认可的 Gotify 渠道插件入口描述符。
 *
 * @description 在宿主加载时：绑定 `gotify` id、人类可读名称、渠道实现、runtime setter
 * 以及 `registerFull` HTTP 扩展注册器。
 */
const gotifyEntry: ReturnType<typeof defineChannelPluginEntry> = defineChannelPluginEntry({
  id: "gotify",
  name: "Gotify",
  description:
    "OpenClaw Gotify channel plugin — REST delivery + WebSocket stream with multi-account session isolation.",
  plugin: gotifyChannel,
  setRuntime: setGotifyRuntime,
  registerFull: registerGotifyFull,
});

export default gotifyEntry;
