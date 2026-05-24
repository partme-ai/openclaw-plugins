/**
 * 美团插件 setup-only 入口（非 full 模式）。
 *
 * **架构角色**：供 `openclaw setup` 仅加载渠道元数据与 wizard，不注册 Webhook。
 *
 * **关键依赖**：`openclaw/plugin-sdk/channel-core`、`./channel`
 */
import { defineSetupPluginEntry } from "openclaw/plugin-sdk/channel-core";

import { meituanChannel } from "./channel.js";

export default defineSetupPluginEntry(meituanChannel as never);
