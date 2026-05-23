/**
 * @partme.ai/openclaw-gotify — OpenClaw Gotify Channel Plugin
 *
 * 入口：注册 Channel、注入 runtime、编排 full 模式 HTTP 路由。
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
 * openclaw-gotify 插件入口 — Gotify channel plugin with REST API + WebSocket stream.
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
