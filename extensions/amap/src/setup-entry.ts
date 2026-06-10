/**
 * 高德渠道 Setup 插件入口（Setup-Only Entry）
 *
 * **架构角色**：轻量入口，仅向 OpenClaw 注册 Channel 定义与 CLI setup 能力，
 * 不加载 Webhook、工具等完整运行时（供 `openclaw setup` 等独立场景使用）。
 *
 * **关键依赖**：
 * - `openclaw/plugin-sdk/channel-core` — `defineSetupPluginEntry`
 * - `./channel` — 高德 Channel 定义体
 */

import { defineSetupPluginEntry } from "openclaw/plugin-sdk/channel-core";

import { amapChannel } from "./channel.js";

/** Setup 专用插件默认导出，挂载 amapChannel 的 wizard / adapter。 */
export default defineSetupPluginEntry(amapChannel as never);
