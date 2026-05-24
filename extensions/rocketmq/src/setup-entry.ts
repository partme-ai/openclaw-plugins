/**
 * @fileoverview RocketMQ 插件的「冷路径」装配入口。
 *
 * @description
 * 仅供 Base Profile / 工具链在 setup 场景拉取 Channel 元数据时使用：只导出
 * `rockermqChannel` 定义，避免冷路径加载 MQ 客户端与 transport 实现。
 *
 * @module setup-entry
 */

/**
 * RocketMQ setup 冷路径：仅导出 Channel 定义，不重复 index 的 HTTP 路由注册。
 */

import { defineSetupPluginEntry } from "openclaw/plugin-sdk/channel-core";

import { rockermqChannel } from "./channel.js";

/** @description Channel 清单默认导出，供 setup 工具链单独解析。 */
export default defineSetupPluginEntry(rockermqChannel);
