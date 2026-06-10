/**
 * @file Gotify Setup Entry — OpenClaw 惰性 Setup 插件壳。
 *
 * @description 当渠道尚未启用或未满足 **full bundle** 条件时，
 * Host 仍可加载本默认导出以读取 **Channel meta / capabilities / docsPath**，
 * **避免**静态拉取 `transport/*`、`gotify-api`、WebSocket 实现等重型依赖。
 * **模块角色**：Channel Plugin · Lightweight discovery surface。
 */

import { defineSetupPluginEntry } from "openclaw/plugin-sdk/channel-core";

import { gotifyChannel } from "./channel.js";

/**
 * OpenClaw setup-runtime 使用的极小占位导出。
 *
 * @description 等价 `defineSetupPluginEntry(gotifyChannel)`；不产生运行时监听或 REST I/O。
 * @returns `SetupPluginEntry` —— SDK 定义的 setup 插件描述对象。
 */
export default defineSetupPluginEntry(gotifyChannel);
