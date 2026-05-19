/**
 * setup-only 入口。
 */

import { defineSetupPluginEntry } from "openclaw/plugin-sdk/channel-core";
import { redisStreamChannel } from "./channel.js";

export default defineSetupPluginEntry(redisStreamChannel);
