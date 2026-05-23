/**
 * 入站归一化 wrapper（插件已解析字段 → UnifiedMessage）。
 *
 * 渠道协议解析留在各渠道插件内；SDK 只接收已归一化的 channel/account/peer/text
 * 等通用字段，避免在基础库中沉淀 gotify/feishu/wecom 等渠道专属 adapter。
 */

import { buildMessage } from "../core/message.js";
import type { UnifiedMessage } from "../core/types.js";

/**
 * NormalizeIngressParams 描述 ingress 模块公开 API 的结构化参数或返回值。
 *
 * 字段命名保持贴近业务语义，便于通道插件在不复制 SDK 实现的情况下组合能力。
 */
export interface NormalizeIngressParams {
  channel: string;
  accountId: string;
  userId?: string;
  peerId?: string;
  agentId?: string;
  text: string;
  chatType?: "direct" | "group";
  direction?: "inbound" | "outbound";
  metadata?: Record<string, unknown>;
}

/**
 * 统一 ingress normalize 入口。
 */
export function normalizeIngress(params: NormalizeIngressParams): UnifiedMessage {
  const userId = params.userId ?? params.peerId;
  if (!userId?.trim()) {
    throw new Error("normalizeIngress requires userId or peerId");
  }
  return buildMessage({
    channel: params.channel,
    accountId: params.accountId,
    userId: userId.trim(),
    agentId: params.agentId,
    text: params.text,
    chatType: params.chatType ?? "direct",
    direction: params.direction ?? "inbound",
    metadata: params.metadata,
  });
}
