/**
 * Gotify Setup Entry — 轻量 setup 入口。
 *
 * 在渠道禁用/未配置/延迟加载时被 OpenClaw 加载，
 * 仅暴露渠道元数据，不导入重量级运行时模块。
 */

import { defineSetupPluginEntry } from "openclaw/plugin-sdk/channel-core";

import { gotifyChannel } from "./channel.js";

/**
 * 轻量 setup 入口，便于 OpenClaw 在非 full 模式下读取渠道元数据。
 */
export default defineSetupPluginEntry(gotifyChannel);
