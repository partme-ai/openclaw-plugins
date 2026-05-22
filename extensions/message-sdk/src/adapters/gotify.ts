/**
 * Gotify 流消息 → UnifiedMessage 适配。
 */

import { buildMessage } from "../core/message.js";
import type { UnifiedMessage } from "../core/types.js";

export interface GotifyStreamLike {
  id?: number | string;
  appid?: number | string;
  message?: string;
  title?: string;
  priority?: number;
  extras?: Record<string, unknown>;
  date?: string;
}

/**
 * 将 Gotify WebSocket /stream 信封映射为 UnifiedMessage。
 */
export function gotifyStreamToUnified(params: {
  accountId: string;
  peerId: string;
  agentId?: string;
  message: GotifyStreamLike;
}): UnifiedMessage {
  const text = typeof params.message.message === "string" ? params.message.message : "";
  return buildMessage({
    channel: "gotify",
    accountId: params.accountId,
    userId: params.peerId,
    agentId: params.agentId,
    text,
    chatType: "direct",
    direction: "inbound",
    metadata: {
      id: params.message.id,
      appid: params.message.appid,
      title: params.message.title,
      priority: params.message.priority,
      extras: params.message.extras,
      date: params.message.date,
    },
  });
}
