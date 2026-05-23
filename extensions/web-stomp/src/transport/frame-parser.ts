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
    // 移除可能的结尾 NULL byte
    const cleaned = data.replace(/\0$/, "");

    // 按换行分割
    const lines = cleaned.split(LF);

    if (lines.length === 0) return null;

    // 第一行是命令
    const command = lines[0].trim() as StompCommand;
    if (!isValidCommand(command)) return null;

    // 解析头部（直到空行）
    const headers: Record<string, string> = {};
    let bodyStartIdx = 1;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];

      // 空行标志着头部结束、body 开始
      if (line === "" || line === "\r") {
        bodyStartIdx = i + 1;
        break;
      }

      // 解析 header: value（STOMP 1.2 中第一个冒号分隔 key/value）
      const colonIdx = line.indexOf(":");
      if (colonIdx > 0) {
        const key = decodeHeaderValue(line.slice(0, colonIdx));
        const value = decodeHeaderValue(line.slice(colonIdx + 1));
        // STOMP 规范：重复 header 以第一个为准
        if (!(key in headers)) {
          headers[key] = value;
        }
      }
    }

    // 剩余部分是 body
    const body =
      bodyStartIdx < lines.length
        ? lines.slice(bodyStartIdx).join(LF)
        : undefined;

    return { command, headers, body: body || undefined };
  } catch (err) {
    console.error("[openclaw_web_stomp] Frame parse error:", err);
    return null;
  }
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
  if (frame.body) {
    const bodyBytes = Buffer.byteLength(frame.body, "utf-8");
    parts.push(`content-length:${bodyBytes}`);
    parts.push(LF);
  }

  // 空行分隔头部和 body
  parts.push(LF);

  // body
  if (frame.body) {
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
    server: "openclaw-web-stomp/0.1.0",
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
  body: string
): StompFrame {
  return {
    command: "MESSAGE",
    headers: {
      subscription: subscriptionId,
      "message-id": messageId,
      destination,
      "content-type": "text/plain",
    },
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
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\c/g, ":")
    .replace(/\\\\/g, "\\");
}

/**
 * 编码 STOMP header 值中的特殊字符
 */
function encodeHeaderValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/:/g, "\\c");
}
