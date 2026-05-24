/**
 * @fileoverview STOMP 插件的「冷路径」装配入口。
 *
 * @description
 * setup 场景仅导出 stomp-tcp Channel 元数据，不加载 TCP Server 与 transport 实现。
 *
 * @module setup-entry
 */

/**
 * STOMP setup 冷路径 — Channel 定义导出。
 */

import { defineSetupPluginEntry } from "openclaw/plugin-sdk/channel-core";

import { stompTcpChannel } from "./channel.js";

/** @description Channel 清单默认导出，供 setup 工具链单独解析。 */
export default defineSetupPluginEntry(stompTcpChannel);
