/**
 * @fileoverview RabbitMQ 插件的「冷路径」装配入口。
 *
 * @description
 * 仅供 Base Profile / 工具链在 setup 场景拉取 Channel 元数据时使用：只导出
 * `rabbitmqChannel` 定义，避免加载 transport/runtime 等热路径模块。
 *
 * @module setup-entry
 */

import { defineSetupPluginEntry } from "openclaw/plugin-sdk/channel-core";

import { rabbitmqChannel } from "./channel.js";

export default defineSetupPluginEntry(rabbitmqChannel);
