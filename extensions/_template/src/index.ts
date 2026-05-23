/**
 * 插件主入口：defineChannelPluginEntry 注册 Channel + Runtime。
 */

import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";

import { plugin as templateChannel } from "./channel.js";
import { setRuntime } from "./runtime.js";

export { plugin as templateChannel } from "./channel.js";

export default defineChannelPluginEntry({
  id: "TEMPLATE_NAME",
  name: "TEMPLATE_LABEL",
  description: "TEMPLATE_DESCRIPTION",
  plugin: templateChannel,
  setRuntime,
});
