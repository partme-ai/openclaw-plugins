/**
 * @module wechat/index
 *
 * 微信（Weixin / iLink Bot）OpenClaw 通道插件主入口。
 *
 * **职责**：
 * - 注册 `weixinPlugin` ChannelPlugin（long-poll getUpdates + sendMessage）
 * - 注入 PluginRuntime 供 monitor / messaging 层访问 OpenClaw channel API
 * - 启动前校验宿主 OpenClaw 版本兼容性（`assertHostCompatibility`）
 *
 * **上下游**：
 * - 上游：OpenClaw Gateway `register(api)`
 * - 下游：`channel.ts` 通道契约；`monitor/` 长轮询；`api/` HTTP 协议；`messaging/` 入出站
 *
 * **关键导出**：默认 plugin 对象、`weixinPlugin`
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { buildChannelConfigSchema } from "openclaw/plugin-sdk/channel-config-schema";

import { weixinPlugin } from "./channel.js";
import { assertHostCompatibility } from "./shared/compat.js";
import { WeixinConfigSchema } from "./config.js";
import { setWeixinRuntime } from "./runtime.js";

export { weixinPlugin } from "./channel.js";

export default {
  id: "openclaw-weixin",
  name: "Weixin",
  description: "Weixin channel (getUpdates long-poll + sendMessage)",
  configSchema: buildChannelConfigSchema(WeixinConfigSchema),
  /**
   * 插件注册回调：校验宿主版本、注入 runtime、注册 ChannelPlugin。
   *
   * @param api - OpenClaw 插件宿主 API
   */
  register(api: OpenClawPluginApi) {
    // Fail-fast: reject incompatible host versions before any side-effects.
    assertHostCompatibility(api.runtime?.version);

    if (api.runtime) {
      setWeixinRuntime(api.runtime);
    }

    api.registerChannel({ plugin: weixinPlugin });
  },
};
