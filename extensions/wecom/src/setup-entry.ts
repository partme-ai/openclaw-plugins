import { defineSetupPluginEntry } from "openclaw/plugin-sdk/channel-core";

import { wecomPlugin } from "./channel.js";

/**
 * 轻量 setup 入口，便于 OpenClaw 在非 full 模式下读取渠道元数据。
 */
export default defineSetupPluginEntry(wecomPlugin);
