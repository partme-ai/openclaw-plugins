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

interface ChannelCfg {
  enabled?: boolean;
  contextInjection?: boolean;
}

interface BridgeConfig {
  channels?: Record<string, ChannelCfg>;
}

export function registerContextInjection(api: OpenClawPluginApi): void {
  const cfg = (api.pluginConfig ?? {}) as BridgeConfig;

  api.on("before_prompt_build", (_event, ctx) => {
    const channelId = ctx?.channelId;
    if (!channelId) return;

    // 检查是否有此渠道的配置
    const channelCfg = cfg.channels?.[channelId];
    if (!channelCfg || channelCfg.enabled === false) return;
    if (channelCfg.contextInjection === false) return;

    const meta = getChannelMeta(channelId);
    // 只对已知渠道注入上下文
    if (!meta) return;

    const preset = PRESETS[meta.contextPreset];
    if (!preset) return;

    return { appendSystemContext: preset };
  });

  api.logger.info("[openclaw-bridge] Context injection registered");
}
