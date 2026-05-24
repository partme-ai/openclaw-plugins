/**
 * @fileoverview Rednode 插件的「冷路径」装配入口。
 *
 * @description
 * setup 场景仅导出 xhs Channel 元数据，不加载 Webhook handler、tools 与 agent 客户端。
 *
 * @module setup-entry
 */

/**
 * Rednode setup 冷路径 — Channel 定义导出。
 */

import { defineSetupPluginEntry } from "openclaw/plugin-sdk/channel-core";

import { xhsChannel } from "./channel.js";

/** @description Channel 清单默认导出，供 setup 工具链单独解析。 */
export default defineSetupPluginEntry(xhsChannel as never);
