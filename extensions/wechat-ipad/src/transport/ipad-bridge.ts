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

const EVENT_TYPES = new Set<string>(Object.values(EventType));

function unref(timer: Timer): Timer {
  timer.unref?.();
  return timer;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readJsonLimited(response: Response, maxBytes: number): Promise<unknown> {
  if (!response.body) return null;
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

export class WechatIpadBridge {
  private ws: WebSocket | null = null;
  private state: BridgeState = "disconnected";
  private reconnectCount = 0;
  private reconnectTimer: Timer | null = null;
  private heartbeatTimer: Timer | null = null;
  private pongTimer: Timer | null = null;
  private stopping = false;
  private lastHeartbeat = 0;
  private loginStatus: WxLoginPayload["status"] | null = null;
  private readonly listeners = new Map<IpadEventType, Set<EventListener>>();

  constructor(
    readonly config: WechatIpadConfig,
    private readonly logger: PluginLogger,
    private readonly random: () => number = Math.random,
  ) {}

  async start(): Promise<void> {
    if (!this.config.enabled) return;
    this.stopping = false;
    this.reconnectCount = 0;
    await this.connect(true);
  }

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

  on<T>(event: IpadEventType, listener: EventListener<T>): () => void {
    const set = this.listeners.get(event) ?? new Set<EventListener>();
    set.add(listener as EventListener);
    this.listeners.set(event, set);
    return () => set.delete(listener as EventListener);
  }

  getState(): BridgeState {
    return this.state;
  }

  getStatusSummary(): Record<string, unknown> {
    return {
      enabled: this.config.enabled,
      state: this.state,
      reconnectCount: this.reconnectCount,
      lastHeartbeat: this.lastHeartbeat ? new Date(this.lastHeartbeat).toISOString() : null,
      loginStatus: this.loginStatus,
    };
  }

  async sendMessage(request: SendMessageRequest): Promise<IpadApiResponse> {
    return this.request("/api/send", "POST", request);
  }

  async getServiceStatus(): Promise<IpadApiResponse> {
    return this.request("/api/status", "GET");
  }

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
      const message = controller.signal.aborted ? "bridge request timed out" : errorMessage(error);
      return { ok: false, error: message };
    } finally {
      clearTimeout(timeout);
    }
  }

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
          reject(new Error(`bridge connection failed: ${errorMessage(error)}`));
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
    socket.on("error", (error) => this.logger.warn(`[wechat-ipad] bridge socket error: ${errorMessage(error)}`));
    socket.on("close", (code) => this.handleClose(socket, code));

    try {
      await opened;
    } catch (error) {
      this.state = "disconnected";
      if (!this.stopping) this.scheduleReconnect();
      if (initial) throw error;
    }
  }

  private handleMessage(raw: WebSocket.RawData): void {
    try {
      const event = parseEvent(raw);
      if (event.type === EventType.Heartbeat) {
        this.lastHeartbeat = Date.now();
        return;
      }
      if (event.type === EventType.LoginStatus) {
        const payload = event.data as Partial<WxLoginPayload>;
        if (typeof payload.status !== "string") throw new Error("login_status payload is invalid");
        this.loginStatus = payload.status as WxLoginPayload["status"];
        this.state = payload.status === "logged_in" ? "logged_in" :
          payload.status === "logged_out" || payload.status === "token_expired" ? "logged_out" : this.state;
      }
      void this.emit(event.type, event.data);
    } catch (error) {
      this.logger.warn(`[wechat-ipad] rejected invalid bridge event: ${errorMessage(error)}`);
    }
  }

  private async emit(type: IpadEventType, data: unknown): Promise<void> {
    for (const listener of this.listeners.get(type) ?? []) {
      try {
        await listener(data);
      } catch (error) {
        this.logger.error(`[wechat-ipad] event handler failed (${type}): ${errorMessage(error)}`);
      }
    }
  }

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

  private startHeartbeat(socket: WebSocket): void {
    this.clearHeartbeat();
    const tick = () => {
      if (this.ws !== socket || socket.readyState !== WebSocket.OPEN) return;
      socket.ping();
      this.pongTimer = unref(setTimeout(() => {
        if (this.ws === socket) socket.terminate();
      }, this.config.network.pongTimeoutMs));
    };
    this.heartbeatTimer = unref(setInterval(tick, this.config.network.heartbeatIntervalMs));
  }

  private handlePong(): void {
    this.lastHeartbeat = Date.now();
    if (this.pongTimer) clearTimeout(this.pongTimer);
    this.pongTimer = null;
  }

  private clearSocket(): void {
    const socket = this.ws;
    this.ws = null;
    if (!socket) return;
    socket.removeAllListeners();
    socket.terminate();
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.pongTimer) clearTimeout(this.pongTimer);
    this.heartbeatTimer = null;
    this.pongTimer = null;
  }

  private clearTimers(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.clearHeartbeat();
  }
}

let activeBridge: WechatIpadBridge | null = null;

export function setActiveBridge(bridge: WechatIpadBridge | null): void {
  activeBridge = bridge;
}

export function getActiveBridge(): WechatIpadBridge | null {
  return activeBridge;
}

export async function sendMessage(request: SendMessageRequest): Promise<IpadApiResponse> {
  return activeBridge?.sendMessage(request) ?? { ok: false, error: "bridge is not running" };
}

export async function getServiceStatus(): Promise<IpadApiResponse> {
  return activeBridge?.getServiceStatus() ?? { ok: false, error: "bridge is not running" };
}

export function getBridgeStatusSummary(): Record<string, unknown> {
  return activeBridge?.getStatusSummary() ?? { enabled: false, state: "disconnected" };
}
