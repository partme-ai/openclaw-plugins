/**
 * STOMP 帧解析与序列化模块
 * 实现 STOMP 1.2 协议的帧编解码
 *
 * STOMP 帧格式：
 * COMMAND\n
 * header1:value1\n
 * header2:value2\n
 * \n
 * body\0
 */

import type { StompFrame, StompCommand } from "../types.js";

/** STOMP 帧结束符 (NULL byte) */
const NULL_BYTE = "\0";

/** 换行符 */
const LF = "\n";

/**
 * 解析 STOMP 帧
 * 将原始文本数据解析为结构化的 StompFrame
 *
 * @param data - 原始帧数据
 * @returns 解析后的帧，null 表示解析失败
 */
export function parseFrame(data: string): StompFrame | null {
  try {
    const cleaned = data.endsWith(NULL_BYTE) ? data.slice(0, -1) : data;
    const separator = /\r?\n\r?\n/.exec(cleaned);
    if (!separator) return null;
    const headerBlock = cleaned.slice(0, separator.index);
    const body = cleaned.slice(separator.index + separator[0].length);
    const lines = headerBlock.split(/\r?\n/);
    const command = lines[0]?.trim() as StompCommand;
    if (!isValidCommand(command)) return null;

    const headers: Record<string, string> = {};
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const colonIdx = line.indexOf(":");
      // 无冒号或空 header 名都属于协议错误，不能静默忽略后继续执行权限相关命令。
      if (colonIdx <= 0) return null;
      const key = decodeHeaderValue(line.slice(0, colonIdx));
      const value = decodeHeaderValue(line.slice(colonIdx + 1));
      // STOMP 1.2：重复 header 以第一个为准，避免后续值覆盖认证/路由字段。
      if (!(key in headers)) {
        headers[key] = value;
      }
    }

    const declaredLength = headers["content-length"];
    if (declaredLength !== undefined) {
      if (!/^\d+$/.test(declaredLength)) return null;
      if (Buffer.byteLength(body, "utf8") !== Number(declaredLength)) return null;
    }

    return { command, headers, body: body || undefined };
  } catch {
    // 解析失败属于外部协议错误，由 transport 统一计数和响应；这里不得绕过插件日志脱敏边界。
    return null;
  }
}

/**
 * 从可能包含半帧或多帧的 WebSocket 文本流中提取完整 STOMP 帧。
 *
 * 未声明 `content-length` 时以第一个 NUL 结束；声明后必须按 UTF-8 字节数越过 body，
 * 因而 body 内的 NUL 不会被误判为帧结束符。未完成的尾帧保留到下一条 WebSocket 消息。
 */
export function extractCompleteFrames(buffer: string): { frames: string[]; rest: string } {
  const frames: string[] = [];
  let rest = buffer.replace(/^[\r\n]+/, "");
  while (rest) {
    const separator = /\r?\n\r?\n/.exec(rest);
    if (!separator) break;
    const bodyStart = separator.index + separator[0].length;
    const headerBlock = rest.slice(0, separator.index);
    const lengthLine = headerBlock
      .split(/\r?\n/)
      .slice(1)
      .find((line) => line.startsWith("content-length:"));
    const declared = lengthLine?.slice("content-length:".length);

    if (declared !== undefined && /^\d+$/.test(declared)) {
      const bodyAndTail = Buffer.from(rest.slice(bodyStart), "utf8");
      const bodyBytes = Number(declared);
      if (bodyAndTail.length <= bodyBytes) break;
      // content-length 后必须紧跟 NUL；不匹配时交给 parseFrame 判错并由服务器关闭连接。
      const consumedTail = bodyAndTail.subarray(0, bodyBytes + 1).toString("utf8");
      frames.push(rest.slice(0, bodyStart) + consumedTail);
      rest = bodyAndTail.subarray(bodyBytes + 1).toString("utf8").replace(/^[\r\n]+/, "");
      continue;
    }

    const end = rest.indexOf(NULL_BYTE, bodyStart);
    if (end < 0) break;
    frames.push(rest.slice(0, end + 1));
    rest = rest.slice(end + 1).replace(/^[\r\n]+/, "");
  }
  return { frames, rest };
}

/**
 * 序列化 STOMP 帧为字符串
 *
 * @param frame - 要序列化的帧
 * @returns 序列化后的帧数据
 */
export function serializeFrame(frame: StompFrame): string {
  const parts: string[] = [frame.command, LF];

  // 序列化头部
  for (const [key, value] of Object.entries(frame.headers)) {
    parts.push(encodeHeaderValue(key));
    parts.push(":");
    parts.push(encodeHeaderValue(value));
    parts.push(LF);
  }

  // 如果有 body，添加 content-length header
  if (frame.body !== undefined && !("content-length" in frame.headers)) {
    const bodyBytes = Buffer.byteLength(frame.body, "utf-8");
    parts.push(`content-length:${bodyBytes}`);
    parts.push(LF);
  }

  // 空行分隔头部和 body
  parts.push(LF);

  // body
  if (frame.body !== undefined) {
    parts.push(frame.body);
  }

  // NULL byte 结束
  parts.push(NULL_BYTE);

  return parts.join("");
}

/**
 * 构建 CONNECTED 帧
 * 服务端响应客户端的 CONNECT 请求
 *
 * @param heartbeat - 心跳配置 (sx,sy)
 * @param session - 可选，会话 ID（连接 ID），供客户端订阅 /topic/session.<session> 接收回复
 */
export function buildConnectedFrame(heartbeat: string, session?: string): StompFrame {
  const headers: Record<string, string> = {
    version: "1.2",
    "heart-beat": heartbeat,
    server: "openclaw-web-stomp/2026.7.1",
  };
  if (session) {
    headers.session = session;
  }
  return {
    command: "CONNECTED",
    headers,
  };
}

/**
 * 构建 MESSAGE 帧
 * 向订阅者推送消息
 *
 * @param subscriptionId - 订阅 ID
 * @param destination - Destination
 * @param messageId - 消息 ID
 * @param body - 消息体
 */
export function buildMessageFrame(
  subscriptionId: string,
  destination: string,
  messageId: string,
  body: string,
  ackId?: string,
): StompFrame {
  const headers: Record<string, string> = {
    subscription: subscriptionId,
    "message-id": messageId,
    destination,
    "content-type": "text/plain",
  };
  if (ackId) {
    headers.ack = ackId;
  }
  return {
    command: "MESSAGE",
    headers,
    body,
  };
}

/**
 * 构建 RECEIPT 帧
 * 确认客户端请求已处理
 *
 * @param receiptId - 客户端指定的 receipt-id
 */
export function buildReceiptFrame(receiptId: string): StompFrame {
  return {
    command: "RECEIPT",
    headers: {
      "receipt-id": receiptId,
    },
  };
}

/**
 * 构建 ERROR 帧
 * 通知客户端发生错误
 *
 * @param message - 错误信息
 * @param receiptId - 关联的 receipt-id（可选）
 */
export function buildErrorFrame(
  message: string,
  receiptId?: string
): StompFrame {
  const headers: Record<string, string> = {
    message,
    "content-type": "text/plain",
  };
  if (receiptId) {
    headers["receipt-id"] = receiptId;
  }
  return {
    command: "ERROR",
    headers,
    body: message,
  };
}

/**
 * 验证 STOMP 命令是否合法
 */
function isValidCommand(cmd: string): cmd is StompCommand {
  const validCommands = [
    "CONNECT",
    "STOMP",
    "CONNECTED",
    "SEND",
    "SUBSCRIBE",
    "UNSUBSCRIBE",
    "BEGIN",
    "COMMIT",
    "ABORT",
    "ACK",
    "NACK",
    "DISCONNECT",
    "MESSAGE",
    "RECEIPT",
    "ERROR",
  ];
  return validCommands.includes(cmd);
}

/**
 * 解码 STOMP header 值中的转义字符
 * STOMP 1.2 规范：\n -> LF, \c -> :, \\ -> \
 */
function decodeHeaderValue(value: string): string {
  let decoded = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char !== "\\") {
      decoded += char;
      continue;
    }
    const escaped = value[++index];
    const replacement = escaped === "n" ? "\n" : escaped === "r" ? "\r" : escaped === "c" ? ":" : escaped === "\\" ? "\\" : undefined;
    if (replacement === undefined) throw new Error("Invalid STOMP header escape");
    decoded += replacement;
  }
  return decoded;
}

/**
 * 编码 STOMP header 值中的特殊字符
 */
function encodeHeaderValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/:/g, "\\c");
}
