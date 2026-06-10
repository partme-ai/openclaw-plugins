/**
 * @module ingress/normalize
 *
 * 入站消息归一化 wrapper（插件已解析字段 → UnifiedMessage）。
 *
 * **职责**：将各渠道插件已完成协议解析的通用字段（channel / account / peer / text 等）
 * 组装为 SDK 统一的 `UnifiedMessage`，不在基础库内沉淀 gotify / feishu / wecom 等
 * 渠道专属 adapter 逻辑。
 *
 * **适用场景**：Wire / HTTP / WebSocket 等入站链路在 policy 校验通过后，调用本模块
 * 产出标准消息对象，再交给 dispatch / agent 路由。
 *
 * **上下游**：
 * - 上游：渠道 adapter 解析后的结构化字段
 * - 下游：`core/message.buildMessage` → `UnifiedMessage` → dispatch pipeline
 *
 * **关键导出**：`normalizeIngress`、`NormalizeIngressParams`
 */

import { buildMessage } from "../core/message.js";
import type { UnifiedMessage } from "../core/types.js";

/**
 * 入站归一化参数。
 *
 * 字段命名贴近业务语义，便于通道插件在不复制 SDK 实现的情况下组合能力。
 */
export interface NormalizeIngressParams {
  /** 渠道标识（如 wecom、feishu） */
  channel: string;
  /** 账号 ID（多账号场景下区分租户） */
  accountId: string;
  /** 用户 ID；若未提供则回退到 peerId */
  userId?: string;
  /** 对端 ID（私聊 userId 或群 chatId） */
  peerId?: string;
  /** 目标 Agent ID（可选，用于多 Agent 路由） */
  agentId?: string;
  /** 消息正文（纯文本或已 strip 的 Markdown） */
  text: string;
  /** 会话类型，默认 `direct` */
  chatType?: "direct" | "group";
  /** 消息方向，默认 `inbound` */
  direction?: "inbound" | "outbound";
  /** 渠道专属扩展元数据（不参与 SDK 核心逻辑） */
  metadata?: Record<string, unknown>;
}

/**
 * 统一 ingress normalize 入口。
 *
 * 将插件侧已解析字段转为 `UnifiedMessage`；`userId` 与 `peerId` 至少提供一个。
 *
 * @param params - 归一化参数，见 {@link NormalizeIngressParams}
 * @returns 构建完成的 `UnifiedMessage`
 * @throws {Error} 当 `userId` 与 `peerId` 均为空或仅空白时
 *
 * @example
 * ```ts
 * const msg = normalizeIngress({
 *   channel: "wecom",
 *   accountId: "default",
 *   peerId: "user123",
 *   text: "你好",
 *   chatType: "direct",
 * });
 * ```
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
