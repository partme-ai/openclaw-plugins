/**
 * Setup 冷路径入口（setup-entry）— 轻量 ChannelPlugin 导出，不注册 HTTP 路由。
 */
import { defineSetupPluginEntry } from "openclaw/plugin-sdk/channel-core";

import { wecomPlugin } from "./channel/channel.js";

export default defineSetupPluginEntry(wecomPlugin);
