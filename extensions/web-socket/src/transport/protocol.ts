/**
 * @module web-socket/transport/protocol
 *
 * 客户端 ↔ Gateway JSON 文本帧协议。
 *
 * 客户端入站：
 * - `{ "version": "1", "type": "message", "text": "...", "messageId?": "..." }`
 * - `{ "version": "1", "type": "ping" }`
 *
 * 服务端出站：
 * - `{ "version": "1", "type": "connected", "connectionId": "..." }`
 * - `{ "type": "reply", "text": "...", "sessionKey?": "...", "messageId?": "..." }`
 * - `{ "type": "pong" }`
 * - `{ "type": "error", "message": "..." }`
 */

/** 当前线上帧协议版本；握手和所有结构化出站帧都会携带它。 */
export const WEBSOCKET_PROTOCOL_VERSION = "1" as const;

function versionedFrame(fields: Record<string, unknown>): string {
  return JSON.stringify({ version: WEBSOCKET_PROTOCOL_VERSION, ...fields });
}

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
  // 为兼容 0.1.x 客户端，暂时接受未声明 version 的 JSON 帧；一旦声明就必须匹配。
  // 客户端应从 connected 帧读取版本，后续主动发送 version="1"。
  if (obj.version !== undefined && obj.version !== WEBSOCKET_PROTOCOL_VERSION) {
    return null;
  }
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
  return versionedFrame({ type: "connected", connectionId });
}

/** 序列化服务端已接收消息的确认帧；messageId 用于客户端关联请求。 */
export function serializeAcceptedFrame(messageId?: string): string {
  return versionedFrame({
    type: "accepted",
    ...(messageId ? { messageId } : {}),
  });
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
  return versionedFrame({
    type: "reply",
    text,
    ...(opts?.sessionKey ? { sessionKey: opts.sessionKey } : {}),
    ...(opts?.messageId ? { messageId: opts.messageId } : {}),
  });
}

/**
 * 把 message-sdk 的 JSON envelope 纳入 WebSocket `reply` 帧。
 *
 * 不能直接透传 envelope：它本身没有 `type`，客户端会把一次成功的 Agent 回复误判为未知帧。
 * 若上游意外返回非 JSON，则降级为普通文本 reply，仍保持协议可解析。
 */
export function serializeEnvelopeReplyFrame(
  wire: string,
  opts?: { sessionKey?: string; messageId?: string },
): string {
  try {
    const envelope = JSON.parse(wire) as unknown;
    if (envelope && typeof envelope === "object" && !Array.isArray(envelope)) {
      return versionedFrame({
        ...(envelope as Record<string, unknown>),
        type: "reply",
        ...(opts?.sessionKey ? { sessionKey: opts.sessionKey } : {}),
        ...(opts?.messageId ? { messageId: opts.messageId } : {}),
      });
    }
  } catch {
    // 非 JSON wire 由下面的文本 reply 兜底；这是可恢复的上游格式差异。
  }
  return serializeReplyFrame(wire, opts);
}

/**
 * 序列化错误帧。
 *
 * @param message - 错误说明
 */
export function serializeErrorFrame(message: string): string {
  return versionedFrame({ type: "error", message });
}

/** 序列化 pong 帧 */
export function serializePongFrame(): string {
  return versionedFrame({ type: "pong" });
}
