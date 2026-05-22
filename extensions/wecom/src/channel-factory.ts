/**
 * 通道工厂探测：为后续迁移 `createChatChannelPlugin` 预留入口。
 *
 * 当前仍导出手写 `wecomPlugin`（`channel.ts`），避免一次性大改破坏 279+ 测试。
 */

import type { ChannelPlugin } from "openclaw/plugin-sdk/core";
import type { ResolvedWeComAccount } from "./utils.js";
import { wecomPlugin } from "./channel.js";

export type ChatChannelPluginFactory = (options: unknown) => ChannelPlugin<ResolvedWeComAccount>;

/**
 * 探测 OpenClaw 是否提供 `createChatChannelPlugin`。
 */
export async function isChatChannelPluginFactoryAvailable(): Promise<boolean> {
  try {
    const mod = await import("openclaw/plugin-sdk/channel-core");
    return typeof mod.createChatChannelPlugin === "function";
  } catch {
    return false;
  }
}

/**
 * 返回当前应注册的通道插件（Phase 4 前固定为手写实现）。
 */
export function resolveWecomChannelPlugin(): ChannelPlugin<ResolvedWeComAccount> {
  return wecomPlugin;
}
