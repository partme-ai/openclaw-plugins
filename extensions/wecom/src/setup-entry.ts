/**
 * 轻量 setup 入口（setup-entry）
 *
 * 供 OpenClaw 在非 full 插件模式下读取 channel 元数据与 setupWizard，
 * 不注册 HTTP 路由。完整能力见 index.ts registerFull。
 */
import { defineSetupPluginEntry } from "openclaw/plugin-sdk/channel-core";

import { wecomPlugin } from "./channel.js";

/**
 * 轻量 setup 入口，便于 OpenClaw 在非 full 模式下读取渠道元数据。
 */
export default defineSetupPluginEntry(wecomPlugin);
