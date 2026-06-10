/**
 * 抖音插件 setup-only 入口（非 full 模式）。
 *
 * **架构角色**：供 `openclaw setup` 等轻量场景仅加载渠道元数据与 wizard，
 * 不注册 Webhook 路由与运营工具。
 *
 * **关键依赖**：`openclaw/plugin-sdk/channel-core`、`./channel`
 */
import { defineSetupPluginEntry } from "openclaw/plugin-sdk/channel-core";

import { douyinChannelPlugin } from "./channel.js";

/**
 * OpenClaw setup 元数据入口（非 full 模式）。
 */
export default defineSetupPluginEntry(douyinChannelPlugin);
