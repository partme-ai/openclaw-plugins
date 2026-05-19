/**
 * setup 入口。
 * 仅导出 ChannelPlugin，避免 setup-only 场景加载完整运行时逻辑。
 */

import { defineSetupPluginEntry } from "openclaw/plugin-sdk/channel-core";
import { mqttWsChannel } from "./channel.js";

/**
 * setup entry 要求导出对象 id 与插件 id 对齐，避免被判定为 id mismatch。
 * 这里在 setup-only 场景覆写 id，不影响 runtime channel id（仍为 mqtt-ws）。
 */
const setupChannelPlugin = {
  ...mqttWsChannel,
  id: "openclaw-web-mqtt",
};

export default defineSetupPluginEntry(setupChannelPlugin);
