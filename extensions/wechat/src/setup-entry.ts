/**
 * 轻量 setup 入口：仅导出 ChannelPlugin，不执行 index 中的完整 register。
 *
 * @see https://docs.openclaw.ai/plugins/sdk-setup#setup-entry
 */

import { defineSetupPluginEntry } from "openclaw/plugin-sdk/channel-core";

import { weixinPlugin } from "./channel.js";

export default defineSetupPluginEntry(weixinPlugin);
