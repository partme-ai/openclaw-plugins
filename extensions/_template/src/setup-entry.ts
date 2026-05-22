import { defineSetupPluginEntry } from "openclaw/plugin-sdk/channel-core";

import { plugin as templateChannel } from "./channel.js";

export default defineSetupPluginEntry(templateChannel);
