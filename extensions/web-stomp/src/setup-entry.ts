/**
 * setup 入口：仅导出 ChannelPlugin。
 */

import { defineSetupPluginEntry } from "openclaw/plugin-sdk/channel-core";
import { stompChannel } from "./channel.js";

const setupChannelPlugin = {
  ...stompChannel,
  id: "openclaw-web-stomp",
};

export default defineSetupPluginEntry(setupChannelPlugin);
