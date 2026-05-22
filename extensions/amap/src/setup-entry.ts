import { defineSetupPluginEntry } from "openclaw/plugin-sdk/channel-core";

import { amapChannel } from "./channel.js";

export default defineSetupPluginEntry(amapChannel as never);
