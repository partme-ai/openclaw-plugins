/**
 * 轻量 setup 入口：只导出 channel plugin，避免 setup-only 场景加载完整 runtime。
 */

import { defineSetupPluginEntry } from "openclaw/plugin-sdk/channel-core";

import { rockermqChannel } from "./channel.js";

export default defineSetupPluginEntry(rockermqChannel);
