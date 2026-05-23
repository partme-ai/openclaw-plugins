/**
 * Setup 冷路径入口：仅导出 ChannelPlugin，不执行 registerFull。
 *
 * @see https://docs.openclaw.ai/plugins/sdk-setup#setup-entry
 */

import { defineSetupPluginEntry } from "openclaw/plugin-sdk/channel-core";

import { plugin as templateChannel } from "./channel.js";

export default defineSetupPluginEntry(templateChannel);
