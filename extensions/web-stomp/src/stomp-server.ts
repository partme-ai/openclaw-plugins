/**
 * STOMP 协议服务器模块
 * 基于 ws 库实现 STOMP over WebSocket
 *
 * 职责：
 * - 启动/停止 WebSocket 服务
 * - 处理 STOMP 帧（CONNECT/SEND/SUBSCRIBE/UNSUBSCRIBE/ACK/NACK/DISCONNECT）
 * - 管理连接生命周期和心跳
 */

import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import type { StompServerConfig, StompConnectionInfo } from "./types.js";
import {
  parseFrame,
  serializeFrame,
  buildConnectedFrame,
  buildReceiptFrame,
  buildErrorFrame,
  buildMessageFrame,
} from "./frame-parser.js";
import { parseDestination, isSendable, isSubscribable } from "./destination-router.js";
import {
  addSubscription,
  removeSubscription,
  removeAllSubscriptions,
  getSubscribers,
} from "./subscription-mgr.js";
import { registerMessage, handleAck, handleNack, cleanupConnection } from "./ack-handler.js";
import { parseMessageAny } from "@partme.ai/openclaw-message-sdk";

/** WebSocket 服务器实例 */
let wss: WebSocketServer | null = null;

/** 已连接的客户端：connectionId -> WebSocket */
const connections = new Map<string, WebSocket>();

/** 连接信息：connectionId -> StompConnectionInfo */
const connectionInfo = new Map<string, StompConnectionInfo>();

/** 入站消息回调 */
let onInboundMessage:
  | ((agentId: string, sessionKey: string, text: string) => void)
  | null = null;

/**
 * 启动 STOMP over WebSocket 服务器
 *
 * @param config - 服务器配置
 * @param messageHandler - 入站消息处理回调
 */
export function startStompServer(
  config: StompServerConfig,
  messageHandler: (agentId: string, sessionKey: string, text: string) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    onInboundMessage = messageHandler;

    wss = new WebSocketServer({
      port: config.wsPort,
      path: config.path,
      maxPayload: 1024 * 1024, // 1MB
    });

    wss.on("connection", (ws) => {
      const connectionId = randomUUID();
      connections.set(connectionId, ws);

      connectionInfo.set(connectionId, {
        connectionId,
        connectedAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        subscriptionCount: 0,
      });

      console.log(`[openclaw_web_stomp] WebSocket connected: ${connectionId}`);

      // 处理收到的消息
      ws.on("message", (data) => {
        const raw = data.toString("utf-8");
        const frame = parseFrame(raw);

        if (!frame) {
          sendFrame(ws, buildErrorFrame("Malformed STOMP frame"));
          return;
        }

        // 更新最后活跃时间
        const info = connectionInfo.get(connectionId);
        if (info) {
          info.lastActiveAt = new Date().toISOString();
        }

        // 分发处理
        handleFrame(connectionId, ws, frame, config);
      });

      // 处理连接关闭
      ws.on("close", () => {
        handleDisconnect(connectionId);
      });

      // 处理错误
      ws.on("error", (err) => {
        console.error(
          `[openclaw_web_stomp] WebSocket error for ${connectionId}:`,
          err
        );
        handleDisconnect(connectionId);
      });
    });

    wss.on("listening", () => {
      console.log(
        `[openclaw_web_stomp] STOMP server listening on ws://0.0.0.0:${config.wsPort}${config.path}`
      );
      resolve();
    });

    wss.on("error", (err) => {
      console.error("[openclaw_web_stomp] Server error:", err);
      reject(err);
    });
  });
}

/**
 * 停止 STOMP 服务器
 */
export async function stopStompServer(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (wss) {
      // 关闭所有连接
      for (const [connId, ws] of connections.entries()) {
        sendFrame(ws, buildErrorFrame("Server shutting down"));
        ws.close();
        handleDisconnect(connId);
      }

      wss.close(() => {
        console.log("[openclaw_web_stomp] STOMP server closed");
        resolve();
      });
      wss = null;
    } else {
      resolve();
    }
  });
}

/**
 * 向指定 Destination 的所有订阅者推送消息
 * 用于 Agent 回复分发
 *
 * @param destination - 目标 Destination
 * @param body - 消息内容
 */
export function publishToDestination(
  destination: string,
  body: string
): void {
  const subscribers = getSubscribers(destination);

  for (const sub of subscribers) {
    const ws = connections.get(sub.connectionId);
    if (!ws || ws.readyState !== WebSocket.OPEN) continue;

    const messageId = registerMessage(
      sub.id,
      sub.connectionId,
      destination,
      sub.ack
    );

    const msgFrame = buildMessageFrame(
      sub.id,
      destination,
      messageId,
      body
    );
    sendFrame(ws, msgFrame);
  }
}

/**
 * 获取所有连接信息
 */
export function getConnectionInfoList(): StompConnectionInfo[] {
  return Array.from(connectionInfo.values());
}

/**
 * 处理 STOMP 帧
 * 根据帧命令分发到对应处理器
 */
function handleFrame(
  connectionId: string,
  ws: WebSocket,
  frame: ReturnType<typeof parseFrame> & object,
  config: StompServerConfig
): void {
  const receiptId = frame.headers["receipt"];

  switch (frame.command) {
    case "CONNECT":
    case "STOMP":
      handleConnect(connectionId, ws, frame, config);
      break;

    case "SEND":
      handleSend(connectionId, frame);
      if (receiptId) sendFrame(ws, buildReceiptFrame(receiptId));
      break;

    case "SUBSCRIBE":
      handleSubscribe(connectionId, frame);
      if (receiptId) sendFrame(ws, buildReceiptFrame(receiptId));
      break;

    case "UNSUBSCRIBE":
      handleUnsubscribe(connectionId, frame);
      if (receiptId) sendFrame(ws, buildReceiptFrame(receiptId));
      break;

    case "ACK":
      handleAck(frame.headers["id"] ?? "");
      if (receiptId) sendFrame(ws, buildReceiptFrame(receiptId));
      break;

    case "NACK":
      handleNack(frame.headers["id"] ?? "");
      if (receiptId) sendFrame(ws, buildReceiptFrame(receiptId));
      break;

    case "DISCONNECT":
      if (receiptId) sendFrame(ws, buildReceiptFrame(receiptId));
      ws.close();
      handleDisconnect(connectionId);
      break;

    default:
      sendFrame(
        ws,
        buildErrorFrame(`Unsupported command: ${frame.command}`, receiptId)
      );
  }
}

/**
 * 处理 CONNECT/STOMP 帧
 * 建立 STOMP 会话
 */
function handleConnect(
  connectionId: string,
  ws: WebSocket,
  frame: ReturnType<typeof parseFrame> & object,
  config: StompServerConfig
): void {
  const login = frame.headers["login"];
  const info = connectionInfo.get(connectionId);

  if (info && login) {
    info.login = login;
  }

  // 协商心跳；将会话 ID 带给客户端以便订阅 /topic/session.<connectionId> 接收 Agent 回复
  const heartbeat = `${config.heartbeatOutgoing},${config.heartbeatIncoming}`;

  sendFrame(ws, buildConnectedFrame(heartbeat, connectionId));
  console.log(
    `[openclaw_web_stomp] STOMP session established: ${connectionId} (login: ${login ?? "anonymous"})`
  );
}

/**
 * 处理 SEND 帧
 * 将消息路由给对应的 Agent
 */
function handleSend(
  connectionId: string,
  frame: ReturnType<typeof parseFrame> & object
): void {
  const destination = frame.headers["destination"];
  if (!destination) return;

  if (!isSendable(destination)) {
    console.warn(
      `[openclaw_web_stomp] Cannot SEND to non-queue destination: ${destination}`
    );
    return;
  }

  const route = parseDestination(destination);
  if (!route || route.target !== "agent") {
    console.warn(
      `[openclaw_web_stomp] Invalid SEND destination: ${destination}`
    );
    return;
  }

  const agentId = route.agentId ?? "default";
  const sessionKey = `stomp:${connectionId}@${agentId}`;

  // Try UnifiedMessage format first
  const rawBody = frame.body ?? "";
  const unifiedMsg = parseMessageAny(rawBody);
  const text = unifiedMsg?.text ?? rawBody;

  console.log(
    `[openclaw_web_stomp] SEND: connection=${connectionId}, agent=${agentId}, text=${text.slice(0, 100)}`
  );

  // 更新连接信息
  const info = connectionInfo.get(connectionId);
  if (info) {
    info.agentId = agentId;
    info.sessionKey = sessionKey;
  }

  // 转发给 OpenClaw
  if (onInboundMessage) {
    onInboundMessage(agentId, sessionKey, text);
  }
}

/**
 * 处理 SUBSCRIBE 帧
 * 注册 Topic 订阅
 */
function handleSubscribe(
  connectionId: string,
  frame: ReturnType<typeof parseFrame> & object
): void {
  const id = frame.headers["id"];
  const destination = frame.headers["destination"];
  const ack = (frame.headers["ack"] ?? "auto") as
    | "auto"
    | "client"
    | "client-individual";

  if (!id || !destination) return;

  if (!isSubscribable(destination)) {
    console.warn(
      `[openclaw_web_stomp] Cannot SUBSCRIBE to non-topic destination: ${destination}`
    );
    return;
  }

  addSubscription(connectionId, { id, destination, ack });

  // 更新订阅计数
  const info = connectionInfo.get(connectionId);
  if (info) {
    info.subscriptionCount++;
  }
}

/**
 * 处理 UNSUBSCRIBE 帧
 * 移除 Topic 订阅
 */
function handleUnsubscribe(
  connectionId: string,
  frame: ReturnType<typeof parseFrame> & object
): void {
  const id = frame.headers["id"];
  if (!id) return;

  removeSubscription(connectionId, id);

  // 更新订阅计数
  const info = connectionInfo.get(connectionId);
  if (info && info.subscriptionCount > 0) {
    info.subscriptionCount--;
  }
}

/**
 * 处理连接断开
 * 清理所有关联资源
 */
function handleDisconnect(connectionId: string): void {
  removeAllSubscriptions(connectionId);
  cleanupConnection(connectionId);
  connections.delete(connectionId);
  connectionInfo.delete(connectionId);
  console.log(`[openclaw_web_stomp] Connection closed: ${connectionId}`);
}

/**
 * 发送 STOMP 帧到客户端
 */
function sendFrame(ws: WebSocket, frame: ReturnType<typeof parseFrame> & object): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(serializeFrame(frame));
  }
}
