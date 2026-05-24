/**
 * iPad 协议桥接层
 *
 * 负责与外部 iPad 协议服务建立 WebSocket 长连接：
 * - 接收微信事件推送（消息、登录状态、好友请求等）
 * - 通过 HTTP API 发送消息、获取状态
 * - 自动重连与心跳管理
 *
 * 架构说明：
 *   iPad 协议服务（独立进程，处理 MMTLS/Protobuf）
 *        ↑ WebSocket 推送事件
 *        ↓ HTTP API 发送消息
 *   openclaw_wechat_ipad（本插件，桥接 OpenClaw）
 *        ↑↓ OpenClaw Runtime 4 步消息管道
 *   OpenClaw Gateway → Agent
 */

import WebSocket from "ws";
import type {
  WechatIpadConfig,
  BridgeState,
  IpadEvent,
  IpadEventType,
  WxMessagePayload,
  WxLoginPayload,
  WxFriendRequestPayload,
  SendMessageRequest,
  IpadApiResponse,
} from "../types.js";

/** 事件监听器类型 */
type EventListener<T = unknown> = (data: T) => void;

/** 事件监听器映射 */
type EventListeners = {
  [K in IpadEventType]?: EventListener[];
};

/** WebSocket 实例（延迟初始化） */
let _ws: WebSocket | null = null;

/** 当前配置 */
let _config: WechatIpadConfig | null = null;

/** 当前连接状态 */
let _state: BridgeState = "disconnected";

/** 重连计数器 */
let _reconnectCount = 0;

/** 重连定时器 */
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;

/** 心跳定时器 */
let _heartbeatTimer: ReturnType<typeof setInterval> | null = null;

/** 事件监听器集合 */
const _listeners: EventListeners = {};

/** 最后心跳时间 */
let _lastHeartbeat = 0;

/** 登录的微信号信息 */
let _loginInfo: WxLoginPayload | null = null;

// ─────────────────── 公共 API ───────────────────

/**
 * 启动桥接连接
 * 初始化 WebSocket 连接到 iPad 协议服务
 *
 * @param config - 插件配置
 */
export function startBridge(config: WechatIpadConfig): void {
  _config = config;
  _reconnectCount = 0;
  connect();
}

/**
 * 停止桥接连接
 * 关闭 WebSocket 连接并清理资源
 */
export function stopBridge(): void {
  clearReconnectTimer();
  clearHeartbeatTimer();

  if (_ws) {
    _ws.removeAllListeners();
    if (_ws.readyState === WebSocket.OPEN || _ws.readyState === WebSocket.CONNECTING) {
      _ws.close(1000, "Plugin shutdown");
    }
    _ws = null;
  }

  _state = "disconnected";
  _loginInfo = null;
  console.log("[wechat-ipad] Bridge stopped");
}

/**
 * 获取当前桥接状态
 */
export function getBridgeState(): BridgeState {
  return _state;
}

/**
 * 获取登录的微信号信息
 */
export function getLoginInfo(): WxLoginPayload | null {
  return _loginInfo;
}

/**
 * 注册事件监听器
 *
 * @param event - 事件类型
 * @param listener - 事件处理函数
 */
export function on<T = unknown>(event: IpadEventType, listener: EventListener<T>): void {
  if (!_listeners[event]) {
    _listeners[event] = [];
  }
  _listeners[event]!.push(listener as EventListener);
}

/**
 * 通过 HTTP API 发送消息到微信
 *
 * @param request - 发送消息请求
 * @returns API 响应
 */
export async function sendMessage(
  request: SendMessageRequest
): Promise<IpadApiResponse> {
  if (!_config) {
    return { ok: false, error: "Bridge not initialized" };
  }

  try {
    const response = await fetch(`${_config.apiUrl}/api/send`, {
      method: "POST",
      headers: buildApiHeaders(),
      body: JSON.stringify(request),
    });

    return (await response.json()) as IpadApiResponse;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("[wechat-ipad] Send message failed:", errMsg);
    return { ok: false, error: errMsg };
  }
}

/**
 * 获取 iPad 协议服务状态
 *
 * @returns 服务状态信息
 */
export async function getServiceStatus(): Promise<IpadApiResponse> {
  if (!_config) {
    return { ok: false, error: "Bridge not initialized" };
  }

  try {
    const response = await fetch(`${_config.apiUrl}/api/status`, {
      method: "GET",
      headers: buildApiHeaders(),
    });

    return (await response.json()) as IpadApiResponse;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return { ok: false, error: errMsg };
  }
}

/**
 * 获取桥接状态摘要（供 HTTP 状态端点使用）
 */
export function getBridgeStatusSummary(): Record<string, unknown> {
  return {
    state: _state,
    reconnectCount: _reconnectCount,
    lastHeartbeat: _lastHeartbeat ? new Date(_lastHeartbeat).toISOString() : null,
    loginInfo: _loginInfo
      ? {
          wxid: _loginInfo.wxid,
          nickname: _loginInfo.nickname,
          status: _loginInfo.status,
        }
      : null,
    serviceUrl: _config?.serviceUrl ?? null,
    apiUrl: _config?.apiUrl ?? null,
  };
}

// ─────────────────── 连接管理 ───────────────────

/**
 * 建立 WebSocket 连接到 iPad 协议服务
 */
function connect(): void {
  if (!_config) return;

  _state = "connecting";
  console.log(`[wechat-ipad] Connecting to ${_config.serviceUrl} ...`);

  const wsUrl = _config.auth.token
    ? `${_config.serviceUrl}?token=${_config.auth.token}`
    : _config.serviceUrl;

  _ws = new WebSocket(wsUrl);

  _ws.on("open", handleOpen);
  _ws.on("message", handleMessage);
  _ws.on("close", handleClose);
  _ws.on("error", handleError);
}

/**
 * WebSocket 连接成功
 */
function handleOpen(): void {
  _state = "connected";
  _reconnectCount = 0;
  console.log("[wechat-ipad] Connected to iPad protocol service");

  startHeartbeat();
}

/**
 * 处理 WebSocket 收到的消息
 * 解析事件并分发给注册的监听器
 *
 * @param raw - 原始消息数据
 */
function handleMessage(raw: WebSocket.RawData): void {
  try {
    const text = raw.toString("utf-8");
    const event = JSON.parse(text) as IpadEvent;

    // 更新心跳时间
    if (event.type === ("heartbeat" as IpadEventType)) {
      _lastHeartbeat = Date.now();
      return;
    }

    // 处理登录状态变更
    if (event.type === ("login_status" as IpadEventType)) {
      const payload = event.data as WxLoginPayload;
      _loginInfo = payload;
      _state = payload.status === "logged_in" ? "logged_in" : _state;
      if (payload.status === "logged_out" || payload.status === "token_expired") {
        _state = "logged_out";
      }
      console.log(`[wechat-ipad] Login status: ${payload.status}${payload.wxid ? ` (${payload.wxid})` : ""}`);
    }

    // 分发给注册的监听器
    emitEvent(event.type, event.data);
  } catch (error) {
    console.error("[wechat-ipad] Failed to parse event:", error);
  }
}

/**
 * WebSocket 连接关闭
 * 根据配置决定是否重连
 *
 * @param code - 关闭状态码
 * @param reason - 关闭原因
 */
function handleClose(code: number, reason: Buffer): void {
  console.log(`[wechat-ipad] Disconnected: code=${code}, reason=${reason.toString()}`);

  _state = "disconnected";
  clearHeartbeatTimer();

  scheduleReconnect();
}

/**
 * WebSocket 连接错误
 *
 * @param error - 错误对象
 */
function handleError(error: Error): void {
  console.error("[wechat-ipad] WebSocket error:", error.message);
}

// ─────────────────── 重连机制 ───────────────────

/**
 * 调度重连
 * 指数退避 + 最大重试次数限制
 */
function scheduleReconnect(): void {
  if (!_config?.reconnect.enabled) return;

  const maxRetries = _config.reconnect.maxRetries;
  if (maxRetries > 0 && _reconnectCount >= maxRetries) {
    console.error(
      `[wechat-ipad] Max reconnect attempts (${maxRetries}) reached, giving up`
    );
    return;
  }

  clearReconnectTimer();

  // 指数退避：base * 2^count，上限 60 秒
  const baseInterval = _config.reconnect.intervalMs;
  const delay = Math.min(baseInterval * Math.pow(2, _reconnectCount), 60_000);
  _reconnectCount++;

  console.log(
    `[wechat-ipad] Reconnecting in ${delay}ms (attempt ${_reconnectCount})`
  );

  _reconnectTimer = setTimeout(() => {
    connect();
  }, delay);
}

/** 清除重连定时器 */
function clearReconnectTimer(): void {
  if (_reconnectTimer) {
    clearTimeout(_reconnectTimer);
    _reconnectTimer = null;
  }
}

// ─────────────────── 心跳管理 ───────────────────

/** 启动心跳 ping */
function startHeartbeat(): void {
  clearHeartbeatTimer();
  _heartbeatTimer = setInterval(() => {
    if (_ws?.readyState === WebSocket.OPEN) {
      _ws.ping();
    }
  }, 30_000);
}

/** 清除心跳定时器 */
function clearHeartbeatTimer(): void {
  if (_heartbeatTimer) {
    clearInterval(_heartbeatTimer);
    _heartbeatTimer = null;
  }
}

// ─────────────────── 事件分发 ───────────────────

/**
 * 触发事件，通知所有注册的监听器
 *
 * @param type - 事件类型
 * @param data - 事件数据
 */
function emitEvent(type: IpadEventType, data: unknown): void {
  const listeners = _listeners[type];
  if (!listeners?.length) return;

  for (const listener of listeners) {
    try {
      listener(data);
    } catch (error) {
      console.error(`[wechat-ipad] Event listener error (${type}):`, error);
    }
  }
}

// ─────────────────── 工具函数 ───────────────────

/**
 * 构建 HTTP API 请求头
 *
 * @returns 请求头对象
 */
function buildApiHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (_config?.auth.token) {
    headers["Authorization"] = `Bearer ${_config.auth.token}`;
  }
  return headers;
}
