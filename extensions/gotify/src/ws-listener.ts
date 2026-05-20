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

export interface GotifyWsListenerDeps {
  WebSocketImpl?: typeof WebSocket;
  onMessage: (message: GotifyStreamEnvelope) => Promise<void> | void;
  onStateChange?: (state: { running: boolean; lastError?: string | null }) => void;
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
  let socket: WebSocket | null = null;
  let stopped = false;
  let reconnectDelay = account.inbound.reconnectDelayMs;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let reconnectAttempts = 0;
  /** 首次连接建立或失败时 resolve */
  let connectionGate: { resolve: () => void; reject: (err: Error) => void } | null = null;

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
      // 通知 start() 等待者：连接已建立
      if (connectionGate) {
        connectionGate.resolve();
        connectionGate = null;
      }
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
      // 首次连接失败时通知 gate
      if (connectionGate) {
        connectionGate.reject(new GotifyWebSocketError(error, 'WEBSOCKET_ERROR'));
        connectionGate = null;
      }
    };

    socket.onclose = (event) => {
      const wasClean = event?.wasClean ? 'clean' : 'unclean';
      const reason = event?.reason || `WebSocket closed (${wasClean})`;
      deps.onStateChange?.({ running: false, lastError: reason });
      if (!stopped) {
        scheduleReconnect();
      }
    };
  };

  const scheduleReconnect = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
    }
    reconnectTimer = setTimeout(() => {
      reconnectAttempts += 1;
      reconnectDelay = Math.min(reconnectDelay * 2, account.inbound.maxReconnectDelayMs);
      connect();
    }, reconnectDelay);
  };

  return {
    start() {
      stopped = false;
      return new Promise<void>((resolve, reject) => {
        connectionGate = { resolve, reject };
        connect();
      });
    },
    stop() {
      stopped = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      // resolve pending start() gate if still waiting
      if (connectionGate) {
        connectionGate.resolve();
        connectionGate = null;
      }
      socket?.close();
      socket = null;
      deps.onStateChange?.({ running: false, lastError: null });
    },
  };
}
