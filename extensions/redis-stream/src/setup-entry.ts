/**
 * @fileoverview Redis Stream 插件的「冷路径」装配入口。
 *
 * @description
 * 仅供 setup 场景拉取 `redisStreamChannel` 元数据，避免加载 transport/runtime。
 *
 * @module setup-entry
 */

import { defineSetupPluginEntry } from "openclaw/plugin-sdk/channel-core";

import { redisStreamChannel } from "./channel.js";

export default defineSetupPluginEntry(redisStreamChannel);
