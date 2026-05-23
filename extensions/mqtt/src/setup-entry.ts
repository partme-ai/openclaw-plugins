/**
 * 轻量 setup 入口：在渠道未启用、未配置或延迟加载时由 Gateway 优先加载，
 * 仅导出 ChannelPlugin，不执行 index 中的 registerFull（HTTP、完整注册等）。
 *
 * @see https://docs.openclaw.ai/plugins/sdk-setup#setup-entry
 * @see https://docs.openclaw.ai/plugins/sdk-entrypoints#definesetuppluginentry
 */

import { defineSetupPluginEntry } from "openclaw/plugin-sdk/channel-core";

import { mqttPlugin } from "./runtime/mqtt-plugin.js";

export default defineSetupPluginEntry(mqttPlugin);
