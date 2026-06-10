/**
 * 轻量 setup 入口：在渠道未启用、未配置或延迟加载时由 Gateway 优先加载，
 * 仅导出 ChannelPlugin，不执行 index 中的 registerFull（HTTP、完整注册等）。
 */

import { defineSetupPluginEntry } from "openclaw/plugin-sdk/channel-core";

import { wechatIpadChannel } from "./channel.js";

export default defineSetupPluginEntry(wechatIpadChannel as never);
