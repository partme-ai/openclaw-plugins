/**
 * 轻量 setup 入口：在未启用或未配置时由 Gateway 优先加载，
 * 仅导出 Channel 元数据，不导入完整采集器与 RPC 桥接。
 */

import { defineSetupPluginEntry } from "openclaw/plugin-sdk/channel-core";

import { prometheusChannel } from "./channel.js";

export default defineSetupPluginEntry(prometheusChannel as never);
