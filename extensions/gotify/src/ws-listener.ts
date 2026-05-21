import WebSocket from 'ws';
import { z } from 'zod';

import type { GotifyStreamEnvelope, ResolvedGotifyAccount } from './types.js';
import { normalizeServerUrl } from './gotify-api.js';
import { GotifyWebSocketError, GotifyConfigError } from './errors.js';

const GotifyStreamEnvelopeSchema = z.object({
  id: z.union([z.number(), z.string()]),
  appid: z.union([z.number(), z.string()]).optional(),
  title: z.string().optional(),
  message: z.string().optional(),
  priority: z.number().optional(),
  extras: z.record(z.string(), z.unknown()).optional(),
  date: z.string().optional(),
  event: z.string().optional(),
});

/** 首次 WebSocket 连接等待超时（毫秒）。 */
const CONNECTION_TIMEOUT_MS = 15_000;

export interface GotifyWsListenerDeps {
  WebSocketImpl?: typeof WebSocket;
  onMessage: (message: GotifyStreamEnvelope) => Promise<void> | void;
  onStateChange?: (state: { running: boolean; lastError?: string | null }) => void;
  /** 测试用：覆盖连接超时。 */
  connectionTimeoutMs?: number;
}

export interface GotifyWsListenerController {
  /** 启动 WebSocket 连接，返回 Promise 在首次连接建立或失败时 resolve */
  start(): Promise<void>;
  stop(): void;
}

/**
 * 创建 Gotify WebSocket 监听器。
 */
export function createGotifyWsListener(
  account: ResolvedGotifyAccount,
  deps: GotifyWsListenerDeps
): GotifyWsListenerController {
  const WebSocketImpl = deps.WebSocketImpl ?? WebSocket;
  const connectionTimeoutMs = deps.connectionTimeoutMs ?? CONNECTION_TIMEOUT_MS;
  let socket: WebSocket | null = null;
  let stopped = false;
  let reconnectDelay = account.inbound.reconnectDelayMs;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let connectionTimeoutTimer: NodeJS.Timeout | null = null;
  let reconnectAttempts = 0;
  /** 首次连接建立或失败时 resolve */
  let connectionGate: { resolve: () => void; reject: (err: Error) => void } | null = null;

  /**
   * 清理首次连接 gate 与超时定时器。
   */
  const settleConnectionGate = (action: 'resolve' | 'reject', error?: Error): void => {
    if (connectionTimeoutTimer) {
      clearTimeout(connectionTimeoutTimer);
      connectionTimeoutTimer = null;
    }
    if (!connectionGate) {
      return;
    }
    if (action === 'resolve') {
      connectionGate.resolve();
    } else {
      connectionGate.reject(error ?? new GotifyWebSocketError('WebSocket connection failed', 'WEBSOCKET_ERROR'));
    }
    connectionGate = null;
  };

  const connect = () => {
    if (stopped) return;
    if (!account.clientToken || !account.serverUrl) {
      const error = 'Missing clientToken or serverUrl';
      deps.onStateChange?.({ running: false, lastError: error });
      throw new GotifyConfigError('clientToken/serverUrl', error);
    }
    if (reconnectAttempts > account.inbound.maxReconnectAttempts) {
      const error = 'WebSocket reconnect attempts exhausted';
      deps.onStateChange?.({ running: false, lastError: error });
      throw new GotifyWebSocketError(error, 'MAX_RECONNECT_ATTEMPTS');
    }

    const url = `${normalizeServerUrl(account.serverUrl).replace(/^http/i, 'ws')}/stream?token=${encodeURIComponent(account.clientToken)}`;
    socket = new WebSocketImpl(url) as unknown as WebSocket;

    socket.onopen = () => {
      reconnectDelay = account.inbound.reconnectDelayMs;
      reconnectAttempts = 0;
      deps.onStateChange?.({ running: true, lastError: null });
      settleConnectionGate('resolve');
    };

    socket.onmessage = async (event) => {
      try {
        const raw = typeof event.data === 'string' ? event.data : event.data.toString();
        const parsed = GotifyStreamEnvelopeSchema.parse(JSON.parse(raw));
        await deps.onMessage(parsed);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        deps.onStateChange?.({ running: true, lastError: errorMsg });
      }
    };

    socket.onerror = (event) => {
      const error = event instanceof ErrorEvent ? event.message : 'WebSocket error';
      deps.onStateChange?.({ running: false, lastError: error });
      settleConnectionGate('reject', new GotifyWebSocketError(error, 'WEBSOCKET_ERROR'));
    };

    socket.onclose = (event) => {
      const wasClean = event?.wasClean ? 'clean' : 'unclean';
      const reason = event?.reason || `WebSocket closed (${wasClean})`;
      deps.onStateChange?.({ running: false, lastError: reason });
      if (connectionGate) {
        settleConnectionGate('reject', new GotifyWebSocketError(reason, 'WEBSOCKET_CLOSED'));
      }
      if (!stopped) {
        scheduleReconnect();
      }
    };
  };

  /**
   * 安排指数退避重连；捕获 connect 同步抛错，避免 uncaught exception。
   */
  const scheduleReconnect = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
    }
    reconnectTimer = setTimeout(() => {
      reconnectAttempts += 1;
      reconnectDelay = Math.min(reconnectDelay * 2, account.inbound.maxReconnectDelayMs);
      try {
        connect();
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        deps.onStateChange?.({ running: false, lastError: errorMsg });
      }
    }, reconnectDelay);
  };

  return {
    start() {
      stopped = false;
      return new Promise<void>((resolve, reject) => {
        connectionGate = { resolve, reject };
        connectionTimeoutTimer = setTimeout(() => {
          if (connectionGate) {
            settleConnectionGate(
              'reject',
              new GotifyWebSocketError('WebSocket connection timed out', 'CONNECTION_TIMEOUT')
            );
            socket?.close();
          }
        }, connectionTimeoutMs);
        try {
          connect();
        } catch (error) {
          settleConnectionGate(
            'reject',
            error instanceof Error ? error : new GotifyWebSocketError(String(error), 'WEBSOCKET_ERROR')
          );
        }
      });
    },
    stop() {
      stopped = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (connectionGate) {
        settleConnectionGate('resolve');
      }
      socket?.close();
      socket = null;
      deps.onStateChange?.({ running: false, lastError: null });
    },
  };
}
