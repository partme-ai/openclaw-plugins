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

/**
 * 向指定 connectionId 发送文本帧。
 */
export function sendToConnection(connectionId: string, payload: string): boolean {
  const ws = connections.get(connectionId);
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return false;
  }
  ws.send(payload);
  const info = connectionInfo.get(connectionId);
  if (info) {
    info.lastActiveAt = new Date().toISOString();
  }
  return true;
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
  connections.clear();
  connectionInfo.clear();
}

/**
 * 读取单条连接元信息。
 */
export function getConnectionInfo(connectionId: string): WebsocketConnectionInfo | null {
  return connectionInfo.get(connectionId) ?? null;
}
