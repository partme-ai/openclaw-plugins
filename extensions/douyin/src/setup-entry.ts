import { defineSetupPluginEntry } from "openclaw/plugin-sdk/channel-core";

import { douyinChannelPlugin } from "./channel.js";

/**
 * OpenClaw setup 元数据入口（非 full 模式）。
 */
export default defineSetupPluginEntry(douyinChannelPlugin);
