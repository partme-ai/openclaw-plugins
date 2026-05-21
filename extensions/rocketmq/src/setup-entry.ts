/**
 * setup-only 入口。
 */

import { defineSetupPluginEntry } from "openclaw/plugin-sdk/channel-core";
import { rockermqChannel } from "./channel.js";

export default defineSetupPluginEntry(rockermqChannel);
