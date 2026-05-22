import { defineSetupPluginEntry } from "openclaw/plugin-sdk/channel-core";

import { xhsChannel } from "./channel.js";

export default defineSetupPluginEntry(xhsChannel as never);
