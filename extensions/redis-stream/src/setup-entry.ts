/**
 * 轻量 setup 入口：只导出 channel plugin。
 */

import { defineSetupPluginEntry } from "openclaw/plugin-sdk/channel-core";

import { redisStreamChannel } from "./channel.js";

export default defineSetupPluginEntry(redisStreamChannel);
