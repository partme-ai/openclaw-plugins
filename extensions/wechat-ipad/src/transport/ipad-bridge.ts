/**
 * @fileoverview 微信 iPad 外部协议服务的双通道桥接层。
 *
 * 本文件不实现 MMTLS、Protobuf 或微信登录协议，而是把使用方自行部署的外部协议服务
 * 适配为 OpenClaw 可以消费的稳定接口：
 *
 * - WebSocket 长连接负责接收消息、登录状态、好友请求等入站事件；
 * - HTTP API 负责发送消息和查询外部服务状态；
 * - 本类统一处理 Bearer Token、报文大小限制、心跳、超时和指数退避重连；
 * - 上层通过事件监听器和模块级活动实例接入 OpenClaw Channel 生命周期。
 *
 * 架构关系：
 *
 * ```text
 * 外部 iPad 协议服务（MMTLS / Protobuf / 登录态）
 *        │ WebSocket 事件                 ▲ HTTP 请求
 *        ▼                                │
 * WechatIpadBridge（连接、校验、心跳、重连、限流边界）
 *        │ 标准化 IpadEvent               ▲ SendMessageRequest
 *        ▼                                │
 * OpenClaw Channel 入站管道 ──────► Agent ──────► 出站管道
 * ```
 *
 * 安全边界：远程地址必须由配置层校验为 WSS/HTTPS；任何来自外部服务的数据仍然是不可信
 * 输入，必须先通过类型、事件名称和大小校验，才能交给上层事件处理器。
 */
import WebSocket from "ws";
import type {
  BridgeState,
  IpadApiResponse,
  IpadEvent,
  IpadEventType,
  PluginLogger,
  SendMessageRequest,
  WechatIpadConfig,
  WxLoginPayload,
} from "../types.js";
import { IpadEventType as EventType } from "../types.js";

type EventListener<T = unknown> = (data: T) => void | Promise<void>;
type Timer = ReturnType<typeof setTimeout>;

/** 桥接层允许进入 OpenClaw 管道的事件白名单。 */
const EVENT_TYPES = new Set<string>(Object.values(EventType));
/** 外部服务允许上报的登录状态白名单，未知字符串不能污染运维状态机。 */
const LOGIN_STATUSES = new Set<WxLoginPayload["status"]>([
  "waiting_scan",
  "scanned",
  "confirmed",
  "logged_in",
  "logged_out",
  "token_expired",
]);

/**
 * 让网络维护定时器不阻止 Node.js 进程正常退出。
 */
function unref(timer: Timer): Timer {
  timer.unref?.();
  return timer;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readJsonLimited(response: Response, maxBytes: number): Promise<unknown> {
  if (!response.body) return null;
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body.cancel();
    throw new Error(`bridge response exceeds ${maxBytes} bytes`);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    size += result.value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error(`bridge response exceeds ${maxBytes} bytes`);
    }
    chunks.push(result.value);
  }
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (merged.byteLength === 0) return null;
  try {
    return JSON.parse(new TextDecoder().decode(merged));
  } catch {
    throw new Error("bridge returned invalid JSON");
  }
}

/** 校验外部 HTTP 服务统一响应信封，避免把任意 JSON 当作成功结果向上传递。 */
function normalizeApiResponse(value: unknown): IpadApiResponse {
  if (!value || typeof value !== "object" || typeof (value as { ok?: unknown }).ok !== "boolean") {
    throw new Error("bridge returned an invalid response envelope");
  }
  const response = value as IpadApiResponse;
  if (response.error !== undefined && typeof response.error !== "string") {
    throw new Error("bridge returned an invalid error field");
  }
  return response;
}

/**
 * 解析并校验 WebSocket 入站事件的最小公共结构。
 * 事件载荷的细分校验由相应业务处理器负责，但未知事件类型会在桥接边界直接拒绝。
 */
function parseEvent(raw: WebSocket.RawData): IpadEvent {
  const parsed = JSON.parse(raw.toString("utf8")) as unknown;
  if (!parsed || typeof parsed !== "object") throw new Error("event must be an object");
  const event = parsed as Partial<IpadEvent>;
  if (typeof event.type !== "string" || !EVENT_TYPES.has(event.type)) {
    throw new Error("event type is not supported");
  }
  if (!("data" in event)) throw new Error("event data is required");
  return event as IpadEvent;
}

/**
 * 外部 iPad 协议服务的生命周期适配器。
 *
 * 一个插件运行实例只应维护一个本类实例。`start`/`stop` 由 OpenClaw Gateway 服务生命周期
 * 驱动；连接意外关闭时由本类调度重连，主动停止时则保证取消全部定时器和监听器。
 */
export class WechatIpadBridge {
  /** WebSocket 实例（延迟初始化）；首次启动或重连时创建，停止后立即释放引用。 */
  private ws: WebSocket | null = null;
  /** 面向状态端点和上层运行时暴露的桥接状态，不直接等同于 WebSocket readyState。 */
  private state: BridgeState = "disconnected";
  /** 当前连续重连次数；连接成功后归零，用于计算指数退避。 */
  private reconnectCount = 0;
  /** 等待下一次重连的单次定时器，非空时禁止重复调度。 */
  private reconnectTimer: Timer | null = null;
  /** 周期性发送 WebSocket Ping 的定时器。 */
  private heartbeatTimer: Timer | null = null;
  /** 单次 Ping 对应的 Pong 等待定时器；超时将强制断开并触发重连。 */
  private pongTimer: Timer | null = null;
  /** 区分主动停机与意外断线，防止 Gateway 停止后再次拉起连接。 */
  private stopping = false;
  /** 最近一次收到外部 heartbeat 事件或 WebSocket Pong 的时间戳。 */
  private lastHeartbeat = 0;
  /** 最近一次由外部服务上报的微信登录态。 */
  private loginStatus: WxLoginPayload["status"] | null = null;
  /** 按事件类型保存上层订阅者；Set 用于避免同一监听器重复注册。 */
  private readonly listeners = new Map<IpadEventType, Set<EventListener>>();

  constructor(
    readonly config: WechatIpadConfig,
    private readonly logger: PluginLogger,
    private readonly random: () => number = Math.random,
  ) {}

  /** 删除异常文本中可能由底层网络库回显的真实 Bearer Token，并限制日志/错误体长度。 */
  private sanitizeError(error: unknown): string {
    let message = errorMessage(error);
    const token = this.config.auth.token;
    if (token) message = message.split(token).join("[REDACTED]");
    return message.length > 1000 ? `${message.slice(0, 1000)}…` : message;
  }

  /** 启动首次连接；`required` 等启动策略由调用本方法的插件服务层决定。 */
  async start(): Promise<void> {
    if (!this.config.enabled) return;
    this.stopping = false;
    this.reconnectCount = 0;
    await this.connect(true);
  }

  /**
   * 幂等停止桥接器并释放 Socket、定时器和事件订阅。
   * 先设置 `stopping`，确保随后触发的 close 事件不会安排新的重连任务。
   */
  async stop(): Promise<void> {
    this.stopping = true;
    this.clearTimers();
    const socket = this.ws;
    this.ws = null;
    if (socket) {
      socket.removeAllListeners();
      if (socket.readyState === WebSocket.OPEN) socket.close(1000, "plugin shutdown");
      else if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
    }
    this.listeners.clear();
    this.state = "disconnected";
    this.loginStatus = null;
  }

  /** 注册某类桥接事件，返回可用于取消订阅的函数。 */
  on<T>(event: IpadEventType, listener: EventListener<T>): () => void {
    const set = this.listeners.get(event) ?? new Set<EventListener>();
    set.add(listener as EventListener);
    this.listeners.set(event, set);
    return () => set.delete(listener as EventListener);
  }

  /** 返回当前连接/登录状态快照。 */
  getState(): BridgeState {
    return this.state;
  }

  /** 返回不包含 Token、wxid 等敏感信息的运维状态摘要。 */
  getStatusSummary(): Record<string, unknown> {
    return {
      enabled: this.config.enabled,
      state: this.state,
      reconnectCount: this.reconnectCount,
      lastHeartbeat: this.lastHeartbeat ? new Date(this.lastHeartbeat).toISOString() : null,
      loginStatus: this.loginStatus,
    };
  }

  /** 通过外部桥接服务发送消息。 */
  async sendMessage(request: SendMessageRequest): Promise<IpadApiResponse> {
    return this.request("/api/send", "POST", request);
  }

  /** 查询外部桥接服务的健康状态和登录状态。 */
  async getServiceStatus(): Promise<IpadApiResponse> {
    return this.request("/api/status", "GET");
  }

  /**
   * 受控 HTTP 调用入口：统一注入认证、请求超时和响应体大小限制，并把网络异常归一化为
   * `{ ok: false, error }`，避免插件出站管道因外部服务异常直接崩溃。
   */
  private async request(path: string, method: "GET" | "POST", body?: unknown): Promise<IpadApiResponse> {
    if (!this.config.enabled) return { ok: false, error: "bridge is disabled" };
    const controller = new AbortController();
    const timeout = unref(setTimeout(() => controller.abort(), this.config.network.requestTimeoutMs));
    try {
      const headers: Record<string, string> = { Accept: "application/json" };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      if (this.config.auth.token) headers.Authorization = `Bearer ${this.config.auth.token}`;
      const response = await fetch(`${this.config.apiUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const payload = await readJsonLimited(response, this.config.network.maxResponseBytes);
      if (!response.ok) throw new Error(`bridge HTTP ${response.status}`);
      return normalizeApiResponse(payload);
    } catch (error) {
      const message = controller.signal.aborted ? "bridge request timed out" : this.sanitizeError(error);
      return { ok: false, error: message };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * 建立新的 WebSocket 连接并绑定事件。
   *
   * `initial=true` 表示 Gateway 启动阶段：首次握手失败需要向调用者抛出，以便上层执行
   * `required` 策略；后台重连失败只继续调度下一次尝试，不产生未处理 Promise。
   */
  private async connect(initial: boolean): Promise<void> {
    if (this.stopping) return;
    this.clearSocket();
    this.state = "connecting";
    const headers = this.config.auth.token
      ? { Authorization: `Bearer ${this.config.auth.token}` }
      : undefined;
    const socket = new WebSocket(this.config.serviceUrl, {
      headers,
      handshakeTimeout: this.config.network.connectTimeoutMs,
      maxPayload: this.config.network.maxEventBytes,
    });
    this.ws = socket;

    let settled = false;
    const opened = new Promise<void>((resolve, reject) => {
      socket.once("open", () => {
        settled = true;
        this.state = "connected";
        this.reconnectCount = 0;
        this.startHeartbeat(socket);
        this.logger.info("[wechat-ipad] connected to external bridge");
        resolve();
      });
      socket.once("error", (error) => {
        if (!settled) {
          settled = true;
          reject(new Error(`bridge connection failed: ${this.sanitizeError(error)}`));
        }
      });
      socket.once("close", (code) => {
        if (!settled) {
          settled = true;
          reject(new Error(`bridge closed before ready (code=${code})`));
        }
      });
    });

    socket.on("message", (raw) => this.handleMessage(raw));
    socket.on("pong", () => this.handlePong());
    socket.on("error", (error) => this.logger.warn(`[wechat-ipad] bridge socket error: ${this.sanitizeError(error)}`));
    socket.on("close", (code) => this.handleClose(socket, code));

    try {
      await opened;
    } catch (error) {
      this.state = "disconnected";
      if (!this.stopping) this.scheduleReconnect();
      if (initial) throw error;
    }
  }

  /** 在桥接边界解析事件、维护内部状态，并将合法业务事件异步分发给上层。 */
  private handleMessage(raw: WebSocket.RawData): void {
    try {
      const event = parseEvent(raw);
      if (event.type === EventType.Heartbeat) {
        this.lastHeartbeat = Date.now();
        return;
      }
      if (event.type === EventType.LoginStatus) {
        const payload = event.data as Partial<WxLoginPayload>;
        if (typeof payload.status !== "string" ||
            !LOGIN_STATUSES.has(payload.status as WxLoginPayload["status"])) {
          throw new Error("login_status payload is invalid");
        }
        this.loginStatus = payload.status as WxLoginPayload["status"];
        this.state = payload.status === "logged_in" ? "logged_in" :
          payload.status === "logged_out" || payload.status === "token_expired" ? "logged_out" : this.state;
      }
      void this.emit(event.type, event.data);
    } catch (error) {
      this.logger.warn(`[wechat-ipad] rejected invalid bridge event: ${this.sanitizeError(error)}`);
    }
  }

  /** 串行通知同类监听器；单个处理器失败只记录错误，不阻断其他监听器。 */
  private async emit(type: IpadEventType, data: unknown): Promise<void> {
    for (const listener of this.listeners.get(type) ?? []) {
      try {
        await listener(data);
      } catch (error) {
        this.logger.error(`[wechat-ipad] event handler failed (${type}): ${this.sanitizeError(error)}`);
      }
    }
  }

  /** 只处理当前活动 Socket 的关闭事件，忽略已被新连接替代的旧 Socket 回调。 */
  private handleClose(socket: WebSocket, code: number): void {
    if (this.ws !== socket) return;
    this.ws = null;
    this.clearHeartbeat();
    this.state = "disconnected";
    if (!this.stopping) {
      this.logger.warn(`[wechat-ipad] bridge disconnected (code=${code})`);
      this.scheduleReconnect();
    }
  }

  /**
   * 使用“指数退避 + 双向抖动”安排下一次连接，降低外部服务恢复时的惊群风险。
   * `maxRetries=0` 表示无限重试，但任意时刻最多只存在一个重连定时器。
   */
  private scheduleReconnect(): void {
    if (this.stopping || !this.config.reconnect.enabled || this.reconnectTimer) return;
    const { maxRetries, initialDelayMs, maxDelayMs, jitterRatio } = this.config.reconnect;
    if (maxRetries > 0 && this.reconnectCount >= maxRetries) {
      this.logger.error("[wechat-ipad] reconnect limit reached");
      return;
    }
    const exponential = Math.min(initialDelayMs * 2 ** this.reconnectCount, maxDelayMs);
    const jitter = exponential * jitterRatio * (this.random() * 2 - 1);
    const delay = Math.max(100, Math.round(exponential + jitter));
    this.reconnectCount += 1;
    this.reconnectTimer = unref(setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect(false);
    }, delay));
  }

  /** 启动 Ping/Pong 存活探测；Pong 超时会终止连接，由 close 路径统一负责重连。 */
  private startHeartbeat(socket: WebSocket): void {
    this.clearHeartbeat();
    const tick = () => {
      if (this.ws !== socket || socket.readyState !== WebSocket.OPEN) return;
      // 理论上上一轮 Pong 应先到达；仍有等待任务说明连接已异常，先清理旧任务再建立唯一超时哨兵。
      if (this.pongTimer) clearTimeout(this.pongTimer);
      socket.ping();
      this.pongTimer = unref(setTimeout(() => {
        if (this.ws === socket) socket.terminate();
      }, this.config.network.pongTimeoutMs));
    };
    this.heartbeatTimer = unref(setInterval(tick, this.config.network.heartbeatIntervalMs));
  }

  /** 确认连接仍然存活并取消本轮 Pong 超时。 */
  private handlePong(): void {
    this.lastHeartbeat = Date.now();
    if (this.pongTimer) clearTimeout(this.pongTimer);
    this.pongTimer = null;
  }

  /** 销毁旧 Socket，通常用于创建新连接前清理残留资源。 */
  private clearSocket(): void {
    const socket = this.ws;
    this.ws = null;
    if (!socket) return;
    socket.removeAllListeners();
    socket.terminate();
  }

  /** 取消心跳周期和当前 Pong 等待任务。 */
  private clearHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.pongTimer) clearTimeout(this.pongTimer);
    this.heartbeatTimer = null;
    this.pongTimer = null;
  }

  /** 取消桥接器持有的全部网络维护定时器。 */
  private clearTimers(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.clearHeartbeat();
  }
}

/**
 * 当前 OpenClaw 插件运行实例注册的桥接器。
 * 模块级辅助 API 只做薄转发，便于 inbound、outbound 和状态路由共享同一条连接。
 */
let activeBridge: WechatIpadBridge | null = null;

/** 由插件服务生命周期设置或清除当前活动桥接器。 */
export function setActiveBridge(bridge: WechatIpadBridge | null): void {
  activeBridge = bridge;
}

/**
 * 仅当调用方仍拥有当前活动实例时才清除全局引用。
 * 热重载期间旧账户的 finally 可能晚于新账户启动，比较实例可避免误清理新连接。
 */
export function clearActiveBridge(bridge: WechatIpadBridge): boolean {
  if (activeBridge !== bridge) return false;
  activeBridge = null;
  return true;
}

/** 获取当前活动桥接器；插件尚未启动时返回 `null`。 */
export function getActiveBridge(): WechatIpadBridge | null {
  return activeBridge;
}

/** 通过当前活动桥接器发送消息；未启动时返回可诊断失败而不是抛出。 */
export async function sendMessage(request: SendMessageRequest): Promise<IpadApiResponse> {
  return activeBridge?.sendMessage(request) ?? { ok: false, error: "bridge is not running" };
}

/** 通过当前活动桥接器查询外部服务状态。 */
export async function getServiceStatus(): Promise<IpadApiResponse> {
  return activeBridge?.getServiceStatus() ?? { ok: false, error: "bridge is not running" };
}

/** 返回可安全展示给 Gateway 运维端点的脱敏状态。 */
export function getBridgeStatusSummary(): Record<string, unknown> {
  return activeBridge?.getStatusSummary() ?? { enabled: false, state: "disconnected" };
}
