import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";

import { plugin as templateChannel } from "./channel.js";
import { setRuntime as setTemplateRuntime } from "./runtime.js";

export { plugin as templateChannel } from "./channel.js";

/**
 * 模板通道插件入口（对齐 gotify / MQ 插件结构）。
 */
export default defineChannelPluginEntry({
  id: "TEMPLATE_NAME",
  name: "TEMPLATE_LABEL",
  description: "TEMPLATE_DESCRIPTION",
  plugin: templateChannel,
  setRuntime: setTemplateRuntime,
});
