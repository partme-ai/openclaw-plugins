/**
 * @fileoverview `before_prompt_build` 钩子注册：按渠道把平台规则注入系统上下文尾部。
 *
 * @description
 * **数据流**：宿主在构建最终 LLM 消息前触发事件 → 读取 `ctx.channelId` → 校验插件配置与该渠道是否启用
 * `contextInjection` → 反查 `channels` 元数据 → 选择 `PRESETS[contextPreset]` 文本 → 返回 `appendSystemContext`。
 *
 * **边界**：对未知 `channelId` 或关闭开关时不修改 Prompt；不抛错以免阻断主对话路径。
 *
 * @module bridge/context-inject
 */

/**
 * OpenClaw Bridge — 上下文注入
 *
 * 根据渠道预设 key 注入对应的系统上下文。
 * 渠道自带工具的不需要重复注入工具说明，只注入平台交互规则。
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { getChannelMeta, type ChannelContextPreset } from "./channels.js";
import { PRESETS } from "./presets.js";

// ── 注册 ──

/** @description 映射自宿主插件配置的「单渠道」松散结构（字段均可缺省）。 */
interface ChannelCfg {
  enabled?: boolean;
  contextInjection?: boolean;
}

/** @description Bridge 配置文件顶层：`channels` 映射可选。 */
interface BridgeConfig {
  channels?: Record<string, ChannelCfg>;
}

/**
 * @description 订阅 `before_prompt_build`，按渠道向系统提示追加平台交互准则片段。
 *
 * @param api - OpenClaw 插件 API（用于读取 `pluginConfig`、挂载事件与写日志）。
 * @returns void（异步副作用通过宿主事件循环触发）。
 * @throws 不抛出：`handler` 内全程短路返回而非抛异常。
 */
export function registerContextInjection(api: OpenClawPluginApi): void {
  const cfg = (api.pluginConfig ?? {}) as BridgeConfig;

  api.on("before_prompt_build", (_event, ctx) => {
    const channelId = ctx?.channelId;
    // 无渠道上下文时不注入，避免污染非 Channel 场景（例如本地 CLI）。
    if (!channelId) return;

    // 仅在配置显式声明该渠道记录且 enabled !== false 时继续。
    const channelCfg = cfg.channels?.[channelId];
    if (!channelCfg || channelCfg.enabled === false) return;

    // 细分开关：允许单独关闭上下文注入但保留其它 Bridge 行为（若后续扩展）。
    if (channelCfg.contextInjection === false) return;

    const meta = getChannelMeta(channelId);

    // 只对注册表中存在的渠道注入；未知 ID 视为非 Bridge 责任范围。
    if (!meta) return;

    const preset = PRESETS[meta.contextPreset];

    // 预设缺失通常是部署不完整（channels/presets 漂移）；静默跳过以免打断对话。
    if (!preset) return;

    return { appendSystemContext: preset };
  });

  api.logger.info("[openclaw-bridge] Context injection registered");
}
