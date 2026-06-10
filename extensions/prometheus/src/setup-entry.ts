/**
 * @description Prometheus 轻量 Setup 入口：仅导出 Channel 元数据，不加载采集器与 RPC 桥。
 */

import { defineSetupPluginEntry } from "openclaw/plugin-sdk/channel-core";

import { prometheusChannel } from "./channel.js";

export default defineSetupPluginEntry(prometheusChannel as never);
