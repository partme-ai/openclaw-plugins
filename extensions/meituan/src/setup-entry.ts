import { defineSetupPluginEntry } from "openclaw/plugin-sdk/channel-core";

import { meituanChannel } from "./channel.js";

export default defineSetupPluginEntry(meituanChannel as never);
