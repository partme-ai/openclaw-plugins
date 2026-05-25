/**
 * @module web-socket/protocol
 *
 * 客户端 ↔ Gateway JSON 文本帧协议。
 *
 * 客户端入站：
 * - `{ "type": "message", "text": "...", "agentId?": "...", "messageId?": "..." }`
 * - `{ "type": "ping" }`
 *
 * 服务端出站：
 * - `{ "type": "connected", "connectionId": "..." }`
 * - `{ "type": "reply", "text": "...", "sessionKey?": "...", "messageId?": "..." }`
 * - `{ "type": "pong" }`
 * - `{ "type": "error", "message": "..." }`
 */

/** 客户端 message 帧解析结果 */
export type ParsedClientMessageFrame = {
  text: string;
  agentId?: string;
  messageId?: string;
  /** 外部协议中的用户/会话对端 id */
  peerId?: string;
};

/**
 * 解析客户端 JSON 文本帧；非 message/ping 或非法 JSON 返回 null。
 *
 * @param raw - WebSocket 文本载荷
 * @returns message 帧字段，或 ping 标记，或 null
 */
export function parseClientFrame(
  raw: string,
): ParsedClientMessageFrame | "ping" | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { text: trimmed };
  }
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const obj = parsed as Record<string, unknown>;
  const type = String(obj.type ?? "message");
  if (type === "ping") {
    return "ping";
  }
  if (type !== "message") {
    return null;
  }
  const text =
    typeof obj.text === "string"
      ? obj.text
      : typeof obj.content === "string"
        ? obj.content
        : "";
  if (!text.trim()) {
    return null;
  }
  return {
    text: text.trim(),
    agentId: typeof obj.agentId === "string" ? obj.agentId.trim() : undefined,
    messageId: typeof obj.messageId === "string" ? obj.messageId.trim() : undefined,
    peerId:
      typeof obj.peerId === "string"
        ? obj.peerId.trim()
        : typeof obj.userId === "string"
          ? obj.userId.trim()
          : typeof obj.from === "string"
            ? obj.from.trim()
            : undefined,
  };
}

/**
 * 序列化 connected 握手帧。
 *
 * @param connectionId - 连接 UUID
 */
export function serializeConnectedFrame(connectionId: string): string {
  return JSON.stringify({ type: "connected", connectionId });
}

/**
 * 序列化 Agent 回复帧。
 *
 * @param text - 回复正文
 * @param opts - 可选 sessionKey / messageId
 */
export function serializeReplyFrame(
  text: string,
  opts?: { sessionKey?: string; messageId?: string },
): string {
  return JSON.stringify({
    type: "reply",
    text,
    ...(opts?.sessionKey ? { sessionKey: opts.sessionKey } : {}),
    ...(opts?.messageId ? { messageId: opts.messageId } : {}),
  });
}

/**
 * 序列化错误帧。
 *
 * @param message - 错误说明
 */
export function serializeErrorFrame(message: string): string {
  return JSON.stringify({ type: "error", message });
}

/** 序列化 pong 帧 */
export function serializePongFrame(): string {
  return JSON.stringify({ type: "pong" });
}
