/**
 * @module web-socket/setup-entry
 *
 * 轻量 setup 入口（延迟加载时仅导出 ChannelPlugin）。
 */

import { defineSetupPluginEntry } from "openclaw/plugin-sdk/channel-core";

import { webSocketPlugin } from "./runtime/web-socket-plugin.js";

export default defineSetupPluginEntry(webSocketPlugin);
