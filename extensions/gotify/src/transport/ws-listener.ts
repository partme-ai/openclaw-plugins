/**
 * @file Gotify WebSocket Listener — `/stream` 实时入站传输层。
 *
 * @description 与服务端建立 WebSocket 长连接，Zod 校验后回调 `onMessage`；
 * 含首次连接 15s 超时、指数退避重连与 `maxReconnectAttempts` 上限。
 * **模块角色**：Channel Plugin · Inbound transport (WebSocket)。
 * **关键依赖**：`ws`、`zod`、`gotify-api.normalizeServerUrl`。
 *
 * ## 连接管理
 * - 首次连接: 15 秒超时门控 (connectionTimeout)
 * - 重连: 指数退避 (reconnectDelay × 2，上限 maxReconnectDelayMs)
 * - 重试上限: maxReconnectAttempts 次后停止
 * - 停止: stop() 清理定时器 + 关闭 socket
 *
 * ## 消息校验
 * - Zod schema 验证每条入站消息结构
 * - 非法消息记录 lastError，不中断连接
 *
 * ## 状态通知
 * - onStateChange({ running, lastError }) 实时推送给 channel 层
 */

import WebSocket from "ws";
import { z } from "zod";

import type { GotifyStreamEnvelope, ResolvedGotifyAccount } from "../types.js";
import { normalizeServerUrl } from "./gotify-api.js";
import { GotifyWebSocketError, GotifyConfigError } from "../shared/errors.js";

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

/**
 * 创建 WebSocket listener 时需要注入的依赖和回调。
 *
 * 通过依赖注入 WebSocketImpl 可以在单元测试中避免真实网络连接。
 */
export interface GotifyWsListenerDeps {
  /** 测试替身或自定义 WebSocket 实现；默认使用 `ws`。 */
  WebSocketImpl?: typeof WebSocket;
  /** 每收到一条合法 Gotify stream 消息时调用。 */
  onMessage: (message: GotifyStreamEnvelope) => Promise<void> | void;
  /** 连接状态和最近错误回调，用于 channel status 快照。 */
  onStateChange?: (state: {
    running: boolean;
    lastError?: string | null;
  }) => void;
  /** 测试用：覆盖连接超时。 */
  connectionTimeoutMs?: number;
}

/**
 * WebSocket listener 生命周期控制器。
 *
 * start 用于首次连接并进入后台重连循环；stop 用于宿主停止账号或插件卸载。
 */
export interface GotifyWsListenerController {
  /** 启动 WebSocket 连接，返回 Promise 在首次连接建立或失败时 resolve */
  start(): Promise<void>;
  /** 停止监听，清理 socket、重连定时器和首次连接 gate。 */
  stop(): void;
}

/**
 * 创建 Gotify WebSocket 监听器。
 *
 * @param account - 已解析 Gotify 账号，必须具备 serverUrl/clientToken。
 * @param deps - WebSocket 实现与消息/状态回调。
 * @returns 可启动和停止的 listener controller。
 */
export function createGotifyWsListener(
  account: ResolvedGotifyAccount,
  deps: GotifyWsListenerDeps,
): GotifyWsListenerController {
  const WebSocketImpl = deps.WebSocketImpl ?? WebSocket;
  const connectionTimeoutMs = deps.connectionTimeoutMs ?? CONNECTION_TIMEOUT_MS;
  let socket: WebSocket | null = null;
  let stopped = false;
  let reconnectDelay = account.inbound.reconnectDelayMs;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let connectionTimeoutTimer: NodeJS.Timeout | null = null;
  let reconnectAttempts = 0;
  const streamUrl =
    account.clientToken && account.serverUrl
      ? `${normalizeServerUrl(account.serverUrl).replace(/^http/i, "ws")}/stream?token=${encodeURIComponent(account.clientToken)}`
      : null;
  /** 首次连接建立或失败时 resolve */
  let connectionGate: {
    resolve: () => void;
    reject: (err: Error) => void;
  } | null = null;

  /**
   * 清理首次连接 gate 与超时定时器。
   */
  const settleConnectionGate = (
    action: "resolve" | "reject",
    error?: Error,
  ): void => {
    if (connectionTimeoutTimer) {
      clearTimeout(connectionTimeoutTimer);
      connectionTimeoutTimer = null;
    }
    if (!connectionGate) {
      return;
    }
    if (action === "resolve") {
      connectionGate.resolve();
    } else {
      connectionGate.reject(
        error ??
          new GotifyWebSocketError(
            "WebSocket connection failed",
            "WEBSOCKET_ERROR",
          ),
      );
    }
    connectionGate = null;
  };

  /**
   * 建立一次 WebSocket 连接。
   *
   * 该函数只负责“当前这一次连接”，断线后的重连由 `scheduleReconnect()` 统一安排。
   * 连接 URL 使用 Gotify 官方 `/stream?token=<clientToken>` 形式；token 只进入内存 URL，
   * 不写入日志或状态快照。
   */
  const connect = () => {
    if (stopped) return;
    if (!streamUrl) {
      const error = "Missing clientToken or serverUrl";
      deps.onStateChange?.({ running: false, lastError: error });
      throw new GotifyConfigError("clientToken/serverUrl", error);
    }
    if (reconnectAttempts > account.inbound.maxReconnectAttempts) {
      const error = "WebSocket reconnect attempts exhausted";
      deps.onStateChange?.({ running: false, lastError: error });
      throw new GotifyWebSocketError(error, "MAX_RECONNECT_ATTEMPTS");
    }

    socket = new WebSocketImpl(streamUrl) as unknown as WebSocket;

    socket.onopen = () => {
      reconnectDelay = account.inbound.reconnectDelayMs;
      reconnectAttempts = 0;
      deps.onStateChange?.({ running: true, lastError: null });
      settleConnectionGate("resolve");
    };

    socket.onmessage = async (event) => {
      try {
        /*
         * Gotify stream 每帧都是 JSON 消息。先转字符串再做 JSON.parse，
         * 最后用 Zod 校验字段类型，避免畸形帧进入 channel 派发逻辑。
         */
        const raw =
          typeof event.data === "string" ? event.data : event.data.toString();
        const parsed = GotifyStreamEnvelopeSchema.parse(JSON.parse(raw));
        await deps.onMessage(parsed);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        deps.onStateChange?.({ running: true, lastError: errorMsg });
      }
    };

    socket.onerror = (event) => {
      const error =
        event instanceof ErrorEvent ? event.message : "WebSocket error";
      deps.onStateChange?.({ running: false, lastError: error });
      settleConnectionGate(
        "reject",
        new GotifyWebSocketError(error, "WEBSOCKET_ERROR"),
      );
    };

    socket.onclose = (event) => {
      const wasClean = event?.wasClean ? "clean" : "unclean";
      const reason = event?.reason || `WebSocket closed (${wasClean})`;
      deps.onStateChange?.({ running: false, lastError: reason });
      if (connectionGate) {
        settleConnectionGate(
          "reject",
          new GotifyWebSocketError(reason, "WEBSOCKET_CLOSED"),
        );
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
      reconnectDelay = Math.min(
        reconnectDelay * 2,
        account.inbound.maxReconnectDelayMs,
      );
      try {
        connect();
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        deps.onStateChange?.({ running: false, lastError: errorMsg });
      }
    }, reconnectDelay);
  };

  return {
    /**
     * 启动 listener 并等待首次连接结果。
     *
     * @returns 首次连接成功或失败后的 Promise；后续重连在后台运行。
     */
    start() {
      stopped = false;
      return new Promise<void>((resolve, reject) => {
        connectionGate = { resolve, reject };
        connectionTimeoutTimer = setTimeout(() => {
          if (connectionGate) {
            settleConnectionGate(
              "reject",
              new GotifyWebSocketError(
                "WebSocket connection timed out",
                "CONNECTION_TIMEOUT",
              ),
            );
            socket?.close();
          }
        }, connectionTimeoutMs);
        try {
          connect();
        } catch (error) {
          settleConnectionGate(
            "reject",
            error instanceof Error
              ? error
              : new GotifyWebSocketError(String(error), "WEBSOCKET_ERROR"),
          );
        }
      });
    },
    /**
     * 停止 listener。
     *
     * stop 是幂等操作：多次调用只会清理已存在的 timer/socket，并把状态回调为未运行。
     */
    stop() {
      stopped = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (connectionGate) {
        settleConnectionGate("resolve");
      }
      socket?.close();
      socket = null;
      deps.onStateChange?.({ running: false, lastError: null });
    },
  };
}
