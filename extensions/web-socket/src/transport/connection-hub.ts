/**
 * @module web-socket/transport/connection-hub
 *
 * 统一连接注册表：服务端入站连接与客户端出站连接共用 send 接口。
 */

import { WebSocket } from "ws";

import type { WebsocketConnectionInfo } from "../types.js";

const connections = new Map<string, WebSocket>();
const connectionInfo = new Map<string, WebsocketConnectionInfo>();

/**
 * 注册可发送消息的 WebSocket 连接。
 */
export function registerConnection(
  connectionId: string,
  ws: WebSocket,
  meta: Omit<WebsocketConnectionInfo, "connectionId"> & { connectionId?: string },
): void {
  connections.set(connectionId, ws);
  connectionInfo.set(connectionId, {
    connectionId,
    connectedAt: meta.connectedAt,
    lastActiveAt: meta.lastActiveAt,
    remoteAddress: meta.remoteAddress,
  });
}

/**
 * 移除连接注册。
 */
export function unregisterConnection(connectionId: string): void {
  connections.delete(connectionId);
  connectionInfo.delete(connectionId);
}

/** 标记连接有入站、出站或心跳活动。 */
export function touchConnection(connectionId: string): void {
  const info = connectionInfo.get(connectionId);
  if (info) info.lastActiveAt = new Date().toISOString();
}

/**
 * 向指定 connectionId 发送文本帧。
 */
export function sendToConnection(
  connectionId: string,
  payload: string,
  maxBufferedBytes = 1024 * 1024,
): boolean {
  const ws = connections.get(connectionId);
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return false;
  }
  if (ws.bufferedAmount + Buffer.byteLength(payload, "utf8") > maxBufferedBytes) {
    ws.close(1013, "Outbound backpressure limit exceeded");
    return false;
  }
  ws.send(payload, (error) => {
    if (error) ws.terminate();
  });
  touchConnection(connectionId);
  return true;
}

/**
 * 等待 `ws.send` 回调后再报告投递结果。
 *
 * Agent 回复、accepted 和公共 Outbound Adapter 使用此路径，避免仅仅把数据放入 `ws` 用户态
 * 缓冲就向上层宣称成功。超时会主动终止半开或长期阻塞的连接，使业务任务有界失败并可重试。
 */
export async function sendToConnectionConfirmed(
  connectionId: string,
  payload: string,
  maxBufferedBytes = 1024 * 1024,
  timeoutMs = 10_000,
): Promise<boolean> {
  const ws = connections.get(connectionId);
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  if (ws.bufferedAmount + Buffer.byteLength(payload, "utf8") > maxBufferedBytes) {
    ws.close(1013, "Outbound backpressure limit exceeded");
    return false;
  }

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (delivered: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (delivered) touchConnection(connectionId);
      resolve(delivered);
    };
    const timer = setTimeout(() => {
      ws.terminate();
      finish(false);
    }, timeoutMs);
    timer.unref();
    try {
      ws.send(payload, (error) => {
        if (error) ws.terminate();
        finish(!error);
      });
    } catch {
      finish(false);
    }
  });
}

/**
 * 当前活跃连接数。
 */
export function getConnectionCount(): number {
  return connections.size;
}

/**
 * 全部连接元信息（状态 API）。
 */
export function getAllConnectionInfo(): WebsocketConnectionInfo[] {
  return [...connectionInfo.values()];
}

/**
 * 清空全部连接（shutdown）。
 */
export function clearAllConnections(): void {
  for (const ws of connections.values()) {
    ws.terminate();
  }
  connections.clear();
  connectionInfo.clear();
}

/**
 * 读取单条连接元信息。
 */
export function getConnectionInfo(connectionId: string): WebsocketConnectionInfo | null {
  return connectionInfo.get(connectionId) ?? null;
}
