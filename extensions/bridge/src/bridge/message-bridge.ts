/**
 * @fileoverview OpenClaw 消息生命周期 Hook → MQ 的 UnifiedMessage 桥接层。
 *
 * @description
 * **架构角色**：监听 `message_received` 与 `message_sent`，分别构造
 * `UnifiedMessage` JSON 并通过 OpenClaw 公共 channel outbound adapter 投递到消息中间件。
 *
 * **配置驱动**：仅当 `pluginConfig.channels.<channelId>` 存在且 `enabled !== false`、
 * `forwardToMq !== false` 时才转发；`mqChannel` 白名单校验后回退 `mqtt`。
 *
 * **ID 设计**：
 * - `traceId`：由 `sessionKey` 等稳定字段确定性派生，同会话 inbound/outbound 共享。
 * - `messageId`：每条消息唯一，含方向/渠道/账号/智能体/时间戳，便于日志检索。
 *
 * **关键依赖**：`openclaw/plugin-sdk`（事件与 publish API）、`./channels.js`（渠道闸门）。
 *
 * @module bridge/message-bridge
 */

/**
 * OpenClaw Bridge — UnifiedMessage 消息桥接
 *
 * 配置驱动：按 channels.<id> 配置决定是否转发到 MQ。
 * 多个渠道共享同一套 UnifiedMessage 转换逻辑。
 *
 * traceId 设计原则：
 *   从会话稳定标识（sessionKey）确定性派生，同一会话的 inbound/outbound
 *   以及下游各节点始终得到相同的 traceId，实现全链路追踪。
 *
 * messageId 设计原则：
 *   每条消息唯一，编码方向/渠道/账号/智能体/时间戳，便于日志排查。
 */

import { createHash, randomUUID } from "node:crypto";

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { clearBridgeRuntime } from "../runtime.js";
import { getChannelMeta } from "./channels.js";
import { redactBridgeError } from "./redact.js";

// ── 已知的合法 MQ 渠道 ──

/** @description Bridge 允许配置的 MQ 传输别名；未知值会在启动期直接拒绝。 */
const MQ_CHANNEL_ALIASES: Record<string, string> = {
  mqtt: "mqtt",
  "mqtt-ws": "mqtt-ws",
  "web-mqtt": "mqtt-ws",
  rabbitmq: "rabbitmq",
  "redis-stream": "redis-stream",
  rocketmq: "rocketmq",
  stomp: "stomp",
  "web-stomp": "stomp",
  "stomp-tcp": "stomp-tcp",
};
const DIRECT_TOPIC_CHANNELS = new Set(["mqtt", "mqtt-ws", "rabbitmq", "redis-stream", "rocketmq"]);
const DIRECT_TARGET_PREFIX = "openclaw-direct-topic:v1:";
const DEFAULT_DELIVERY = {
  maxAttempts: 3,
  retryDelayMs: 250,
  publishTimeoutMs: 5_000,
  maxPayloadBytes: 1_048_576,
  maxInFlight: 4,
  maxBufferedMessages: 1_024,
  shutdownTimeoutMs: 10_000,
};

// ── 消息类型 ──

/** @description UnifiedMessage 正文格式抽象（当前桥接路径主要产出 `text`）。 */
type MessageContentType = "text" | "markdown" | "mixed";

/**
 * @description 跨渠道统一的消息信封，供 MQ 消费者与下游 Router 解析。
 */
export interface UnifiedMessage {
  /** @description 单条消息唯一 ID（见 `generateMessageId`）。 */
  messageId: string;
  /** @description 会话级追踪 ID（见 `deriveTraceId`）；同 sessionKey 下 inbound/outbound 一致。 */
  traceId: string;
  /** @description Unix 毫秒时间戳（消息构建时刻）。 */
  timestamp: number;
  /** @description 消息来源：渠道、账号、智能体、用户及会话类型。 */
  source: {
    /** @description OpenClaw 逻辑渠道 ID。 */
    channel: string;
    /** @description 渠道侧账号/机器人实例 ID。 */
    accountId: string;
    /** @description 处理该会话的智能体 ID。 */
    agentId: string;
    /** @description 终端用户或发送方标识。 */
    userId: string;
    /** @description 单聊或群聊上下文。 */
    chatType: "direct" | "group";
  };
  /** @description （可选）多播/路由目标渠道列表，桥接路径通常不填充。 */
  target?: { channels: string[] };
  /** @description 正文格式标签。 */
  contentType: MessageContentType;
  /** @description 从消息 Hook 载荷提取的纯文本正文。 */
  text: string;
  /** @description （可选）Markdown 变体正文，当前 build 路径未单独填充。 */
  markdown?: string;
  /** @description 附件列表；桥接路径默认为空数组。 */
  media: Array<{ url: string; kind: string; mimeType: string; fileName?: string }>;
  /** @description 扩展元数据（含 sessionKey、bridge 标识、direction 等）。 */
  metadata?: Record<string, unknown>;
  /** @description 相对 Agent 的方向：用户入站或助手出站。 */
  direction: "inbound" | "outbound";
}

// ── ID 生成 ──

/**
 * @description 确定性字符串哈希：截取 SHA-256 的 128 位十六进制摘要，用于 trace 摘要段。
 * @param input - 待哈希的 UTF-16 字符串（通常为 channel:account:agent:sessionKey）。
 * @returns 固定 32 字符摘要；同输入恒同输出，并把实际 sessionKey 隐藏在摘要之后。
 * @throws 不抛出。
 */
function stableHash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 32);
}

/**
 * @description 将路径段中的 `/` 替换为 `_`，避免 traceId/messageId 分段解析歧义。
 * @param seg - 原始段（渠道名、账号 ID 等）。
 * @returns 安全段字符串。
 * @throws 不抛出。
 */
function safeSegment(seg: string): string {
  return seg.replace(/\//g, "_");
}

/**
 * @description 从会话稳定标识确定性派生 traceId，供全链路关联 inbound/outbound。
 *
 * 逻辑：sessionKey 是 OpenClaw 为每个会话分配的唯一稳定 key，
 * 同一会话中 inbound/outbound 共享同一个 sessionKey → 同一个 traceId。
 * 加上 channel/accountId/agentId 使 traceId 在跨渠道路由时可辨识来源。
 *
 * 格式: `trace/{channelSafe}/{accountSafe}/{agentSafe}/{stableDigest}`
 * 示例: `trace/discord/main/assistant/97f08fbb70f78d0cda0d3e72de30b92e`
 *
 * @param channel - OpenClaw 逻辑渠道 ID。
 * @param accountId - 渠道账号/机器人实例 ID。
 * @param agentId - 智能体 ID。
 * @param sessionKey - 宿主分配的会话稳定键。
 * @returns 可嵌入 topic/日志的路径式 traceId。
 * @throws 不抛出。
 */
export function deriveTraceId(
  channel: string,
  accountId: string,
  agentId: string,
  sessionKey: string,
): string {
  const digest = stableHash(`${channel}:${accountId}:${agentId}:${sessionKey}`);
  return `trace/${safeSegment(channel)}/${safeSegment(accountId)}/${safeSegment(agentId)}/${digest}`;
}

/**
 * @description 生成单条消息唯一 messageId，含方向缩写、时间与密码学随机 UUID 后缀。
 *
 * 格式: `bridge/{in|out}/{channel}/{accountId}/{agentId}/{ts36}-{uuid}`
 * 示例: `bridge/in/discord/main/assistant/m1a2b3c-550e8400e29b41d4a716446655440000`
 *
 * 不能使用截断的 `Math.random()`：四位 base36 只有约 168 万种组合，高吞吐同毫秒内会受
 * 生日悖论影响发生碰撞，进而破坏去重、重试和审计身份。UUID v4 提供 122 位随机熵。
 *
 * @param channel - OpenClaw 逻辑渠道 ID。
 * @param accountId - 渠道账号 ID。
 * @param agentId - 智能体 ID。
 * @param direction - `inbound` 映射为路径段 `in`，`outbound` 为 `out`。
 * @returns 全局唯一（工程语义）的消息 ID 字符串。
 * @throws 不抛出。
 */
export function generateMessageId(
  channel: string,
  accountId: string,
  agentId: string,
  direction: "inbound" | "outbound",
): string {
  const ts = Date.now().toString(36);
  const uniqueSuffix = randomUUID().replaceAll("-", "");
  return `bridge/${direction === "inbound" ? "in" : "out"}/${safeSegment(channel)}/${safeSegment(accountId)}/${safeSegment(agentId)}/${ts}-${uniqueSuffix}`;
}

/**
 * @description 从运行时上下文字段组装完整 `UnifiedMessage`（公开 API，供测试与下游直接构建）。
 * @param params - 构建参数。
 * @param params.channel - 逻辑渠道 ID。
 * @param params.accountId - 账号 ID。
 * @param params.agentId - 智能体 ID。
 * @param params.sessionKey - 会话稳定键（用于 traceId）。
 * @param params.userId - 用户/发送方 ID。
 * @param params.chatType - 单聊或群聊，默认 `direct`。
 * @param params.text - 正文，默认空串。
 * @param params.direction - 消息方向，默认 `inbound`。
 * @param params.metadata - 可选扩展元数据。
 * @returns 填充了 messageId、traceId、timestamp 的 UnifiedMessage。
 * @throws 不抛出。
 */
export function buildMessage(params: {
  channel: string;
  accountId: string;
  agentId: string;
  sessionKey: string;
  userId: string;
  chatType?: "direct" | "group";
  text?: string;
  direction?: "inbound" | "outbound";
  metadata?: Record<string, unknown>;
  messageId?: string;
  traceId?: string;
  timestamp?: number;
}): UnifiedMessage {
  const direction = params.direction ?? "inbound";
  return {
    messageId: params.messageId ?? generateMessageId(params.channel, params.accountId, params.agentId, direction),
    traceId: params.traceId ?? deriveTraceId(params.channel, params.accountId, params.agentId, params.sessionKey),
    timestamp: params.timestamp ?? Date.now(),
    source: {
      channel: params.channel,
      accountId: params.accountId,
      agentId: params.agentId,
      userId: params.userId,
      chatType: params.chatType ?? "direct",
    },
    contentType: "text",
    text: params.text ?? "",
    media: [],
    metadata: params.metadata,
    direction,
  };
}

// ── 桥接逻辑 ──

/** @description 单渠道 MQ 转发开关（映射自 `pluginConfig.channels` 条目）。 */
export interface BridgeChannelConfig {
  /** @description 为 `false` 时该渠道完全不桥接。 */
  enabled?: boolean;
  /** @description 为 `false` 时跳过消息 Hook → MQ。 */
  forwardToMq?: boolean;
  /** @description MQ 传输别名，须落在 `VALID_MQ_CHANNELS` 内才原样使用。 */
  mqChannel?: string;
  mqAccountId?: string;
  topicPrefix?: string;
  /** @description 是否允许把 Bridge 上下文注入 Prompt；默认开启。 */
  contextInjection?: boolean;
}

/** @description Bridge 插件配置根：`channels` 键为 channelId。 */
export interface BridgeConfig {
  channels?: Record<string, BridgeChannelConfig>;
  delivery?: Partial<typeof DEFAULT_DELIVERY>;
}

/**
 * @description 从宿主 API 读取并断言 Bridge 插件配置形状。
 * @param api - OpenClaw 插件 API。
 * @returns 松散类型的 Bridge 配置对象（缺省字段由调用方解释）。
 * @throws 不抛出。
 */
function getConfig(api: OpenClawPluginApi): BridgeConfig {
  return (api.pluginConfig ?? {}) as BridgeConfig;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function extractText(content: unknown): string | undefined {
  if (typeof content === "string") return readString(content);
  if (!Array.isArray(content)) return undefined;
  const parts = content.flatMap((part) => {
    if (!part || typeof part !== "object") return [];
    const value = part as Record<string, unknown>;
    const text = readString(value.text) ?? readString(value.content);
    return text ? [text] : [];
  });
  return parts.length > 0 ? parts.join("\n") : undefined;
}

function resolveMqChannel(value: string | undefined): string {
  const requested = value ?? "mqtt";
  const resolved = MQ_CHANNEL_ALIASES[requested];
  if (!resolved) {
    throw new Error(`[openclaw-bridge] unsupported mqChannel "${requested}"; expected one of ${Object.keys(MQ_CHANNEL_ALIASES).join(", ")}`);
  }
  return resolved;
}

function resolveDelivery(config: BridgeConfig): typeof DEFAULT_DELIVERY {
  const delivery = { ...DEFAULT_DELIVERY, ...config.delivery };
  for (const [name, value] of Object.entries(delivery)) {
    if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
      throw new Error(`[openclaw-bridge] delivery.${name} must be a positive integer`);
    }
  }
  return delivery;
}

/**
 * 对 manifest Schema 之外的运行时入口再次校验 Bridge 配置。
 *
 * 校验根字段、delivery 数值、源渠道白名单、MQ 目标别名及每个渠道字段类型，防止测试、
 * 旧配置迁移或直接 API 注册绕过 JSON Schema 后把错误值带入消息 Hook。
 */
export function validateBridgeConfig(config: BridgeConfig): void {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("[openclaw-bridge] config must be an object");
  }
  const rootUnknown = Object.keys(config).filter((key) => key !== "channels" && key !== "delivery");
  if (rootUnknown.length > 0) throw new Error(`[openclaw-bridge] unknown config field: ${rootUnknown.join(", ")}`);
  if (config.delivery !== undefined && (!config.delivery || typeof config.delivery !== "object" || Array.isArray(config.delivery))) {
    throw new Error("[openclaw-bridge] delivery must be an object");
  }
  const deliveryUnknown = Object.keys(config.delivery ?? {}).filter((key) => !(key in DEFAULT_DELIVERY));
  if (deliveryUnknown.length > 0) throw new Error(`[openclaw-bridge] unknown delivery field: ${deliveryUnknown.join(", ")}`);
  if (config.channels !== undefined && (!config.channels || typeof config.channels !== "object" || Array.isArray(config.channels))) {
    throw new Error("[openclaw-bridge] channels must be an object");
  }
  resolveDelivery(config);
  for (const [channelId, channel] of Object.entries(config.channels ?? {})) {
    if (!getChannelMeta(channelId)) throw new Error(`[openclaw-bridge] unsupported source channel "${channelId}"`);
    if (!channel || typeof channel !== "object" || Array.isArray(channel)) {
      throw new Error(`[openclaw-bridge] channels.${channelId} must be an object`);
    }
    const channelUnknown = Object.keys(channel).filter((key) =>
      !["enabled", "forwardToMq", "mqChannel", "mqAccountId", "topicPrefix", "contextInjection"].includes(key));
    if (channelUnknown.length > 0) throw new Error(`[openclaw-bridge] channels.${channelId} has unknown field: ${channelUnknown.join(", ")}`);
    for (const name of ["enabled", "forwardToMq", "contextInjection"] as const) {
      if (channel[name] !== undefined && typeof channel[name] !== "boolean") {
        throw new Error(`[openclaw-bridge] channels.${channelId}.${name} must be a boolean`);
      }
    }
    if (channel.mqChannel !== undefined && !readString(channel.mqChannel)) {
      throw new Error(`[openclaw-bridge] channels.${channelId}.mqChannel must be non-empty`);
    }
    resolveMqChannel(channel.mqChannel);
    if (channel.mqAccountId !== undefined && !readString(channel.mqAccountId)) {
      throw new Error(`[openclaw-bridge] channels.${channelId}.mqAccountId must be non-empty`);
    }
    if (channel.topicPrefix !== undefined && !readString(channel.topicPrefix)) {
      throw new Error(`[openclaw-bridge] channels.${channelId}.topicPrefix must be non-empty`);
    }
  }
}

function encodeTarget(channel: string, topic: string): string {
  if (DIRECT_TOPIC_CHANNELS.has(channel)) return `${DIRECT_TARGET_PREFIX}${encodeURIComponent(topic)}`;
  if (channel === "stomp" || channel === "stomp-tcp") {
    return topic.startsWith("/topic/") ? topic : `/topic/${topic.replaceAll("/", ".")}`;
  }
  return topic;
}

/**
 * 判断一次源渠道出站是否正是 Bridge 自己写入的审计 Topic。
 * 当源和目标同为 MQTT 等 MQ 渠道时，若不做此闸门，`message_sent` 会再次镜像审计消息并形成递归。
 */
function isBridgeAuditTarget(
  target: string,
  sourceChannel: string,
  channelConfig: BridgeChannelConfig,
): boolean {
  const mqChannel = resolveMqChannel(channelConfig.mqChannel);
  if (mqChannel !== sourceChannel) return false;
  const topicPrefix = readString(channelConfig.topicPrefix) ?? `openclaw/bridge/${sourceChannel}`;
  for (const direction of ["inbound", "outbound"] as const) {
    const topic = `${topicPrefix.replace(/\/$/, "")}/${direction}`;
    if (target === topic || target === encodeTarget(mqChannel, topic)) return true;
  }
  return false;
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, signal: AbortSignal): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  let rejectOnAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`publish timed out after ${timeoutMs}ms; outcome is unknown`)), timeoutMs);
        timer.unref();
      }),
      new Promise<never>((_, reject) => {
        rejectOnAbort = () => reject(new Error("bridge delivery stopped; outcome is unknown"));
        if (signal.aborted) {
          rejectOnAbort();
          return;
        }
        signal.addEventListener("abort", rejectOnAbort, { once: true });
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (rejectOnAbort) signal.removeEventListener("abort", rejectOnAbort);
  }
}

/** 创建可被停止生命周期打断的等待，避免关闭时仍睡满整个重试退避时间。 */
async function waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new Error("bridge delivery stopped");
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, delayMs);
    timer.unref();
    signal.addEventListener("abort", aborted, { once: true });

    function done(): void {
      signal.removeEventListener("abort", aborted);
      resolve();
    }

    function aborted(): void {
      clearTimeout(timer);
      reject(new Error("bridge delivery stopped"));
    }
  });
}

async function publishToMq(params: {
  api: OpenClawPluginApi;
  config: BridgeConfig;
  channelConfig: BridgeChannelConfig;
  sourceChannel: string;
  direction: "inbound" | "outbound";
  message: UnifiedMessage;
  signal: AbortSignal;
}): Promise<void> {
  const mqChannel = resolveMqChannel(params.channelConfig.mqChannel);
  const topicPrefix = readString(params.channelConfig.topicPrefix) ?? `openclaw/bridge/${params.sourceChannel}`;
  const topic = `${topicPrefix.replace(/\/$/, "")}/${params.direction}`;
  const content = JSON.stringify(params.message);
  const delivery = resolveDelivery(params.config);
  if (Buffer.byteLength(content, "utf8") > delivery.maxPayloadBytes) {
    throw new Error(`[openclaw-bridge] payload exceeds delivery.maxPayloadBytes=${delivery.maxPayloadBytes}`);
  }
  let lastError: unknown;
  for (let attempt = 1; attempt <= delivery.maxAttempts; attempt += 1) {
    if (params.signal.aborted) throw new Error("bridge delivery stopped");
    try {
      const adapter = await params.api.runtime.channel.outbound.loadAdapter(mqChannel);
      if (!adapter?.sendText) throw new Error(`[openclaw-bridge] outbound adapter unavailable or lacks sendText: ${mqChannel}`);
      await withTimeout(adapter.sendText({
        cfg: params.api.runtime.config.current() as never,
        to: encodeTarget(mqChannel, topic),
        text: content,
        accountId: params.channelConfig.mqAccountId ?? null,
        deliveryQueueId: params.message.messageId,
      }), delivery.publishTimeoutMs, params.signal);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < delivery.maxAttempts) {
        await waitForRetry(delivery.retryDelayMs * attempt, params.signal);
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * 单条待镜像任务。这里保存已经归一化后的不可变消息，而不是原始 Hook 上下文，避免宿主在
 * Hook 返回后复用或修改事件对象，导致后台投递读到漂移数据。
 */
interface BridgeDeliveryJob {
  channelConfig: BridgeChannelConfig;
  sourceChannel: string;
  direction: "inbound" | "outbound";
  message: UnifiedMessage;
}

/**
 * Bridge 的进程内有界投递器。
 *
 * Hook 是 OpenClaw 主消息链的一部分，因此只能完成“校验、归一化、入队”，不能在 Hook 内等待
 * Broker 重试。后台投递器限制并发和等待队列；停机时先排空，超时后中断退避并丢弃尚未开始的
 * 观测镜像。它不是持久化 Outbox，进程崩溃时未完成任务仍可能丢失。
 */
class BridgeDeliveryDispatcher {
  private readonly queue: BridgeDeliveryJob[] = [];
  private readonly drainWaiters = new Set<() => void>();
  private readonly activeTraceIds = new Set<string>();
  private abortController = new AbortController();
  private activeCount = 0;
  private accepting = false;
  private stopping = false;

  constructor(
    private readonly api: OpenClawPluginApi,
    private readonly config: BridgeConfig,
    private readonly delivery: typeof DEFAULT_DELIVERY,
  ) {}

  /**
   * 显式 Service 生命周期和 Hook Runtime 的惰性启动共用此入口。
   * OpenClaw 2026.7.1 会为消息 Hook 创建独立插件 Runtime，该 Runtime 不会启动 registerService；
   * 因此 start 必须幂等，并允许首次 Hook 入队时启动当前实例的投递器。
   */
  start(): void {
    if (this.accepting) return;
    this.abortController = new AbortController();
    this.stopping = false;
    this.accepting = true;
    this.pump();
  }

  /**
   * 非阻塞入队。队列已满时明确记录丢弃，而不是继续占用内存拖垮 Gateway。
   */
  enqueue(job: BridgeDeliveryJob): boolean {
    if (!this.accepting) {
      if (!this.stopping) {
        // 消息 Hook 的 scoped runtime 不执行 Gateway service.start；惰性启动才能保证该实例可投递。
        this.start();
      }
    }
    if (!this.accepting) {
      this.api.logger.warn(`[openclaw-bridge] delivery service is not accepting messageId=${job.message.messageId}`);
      return false;
    }
    if (this.queue.length >= this.delivery.maxBufferedMessages) {
      this.api.logger.error(
        `[openclaw-bridge] delivery queue full; dropped messageId=${job.message.messageId} ` +
        `channel=${job.sourceChannel} direction=${job.direction}`,
      );
      return false;
    }
    this.queue.push(job);
    this.pump();
    return true;
  }

  /** 停止接收后等待在途和排队任务；达到上限则以可观测方式有界退出。 */
  async stop(): Promise<void> {
    this.stopping = true;
    this.accepting = false;
    if (this.isDrained()) return;

    let timer: NodeJS.Timeout | undefined;
    const drained = await Promise.race([
      this.waitUntilDrained().then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), this.delivery.shutdownTimeoutMs);
        timer.unref();
      }),
    ]);
    if (timer) clearTimeout(timer);
    if (drained) return;

    const dropped = this.queue.length;
    this.queue.length = 0;
    this.abortController.abort();
    this.api.logger.error(
      `[openclaw-bridge] shutdown timed out after ${this.delivery.shutdownTimeoutMs}ms; ` +
      `dropped queued=${dropped}, inFlight=${this.activeCount}; in-flight outcomes may be unknown`,
    );
    this.notifyIfDrained();
    await this.waitUntilDrained();
  }

  private pump(): void {
    // accepting=false 只禁止新任务；停机排空阶段仍必须继续启动已经进入队列的任务。
    while (!this.abortController.signal.aborted && this.activeCount < this.delivery.maxInFlight) {
      // 同一 traceId 通常代表同一会话。只并发不同会话，避免后发回复越过正在重试的前一条消息。
      const nextIndex = this.queue.findIndex((candidate) => !this.activeTraceIds.has(candidate.message.traceId));
      if (nextIndex < 0) break;
      const [job] = this.queue.splice(nextIndex, 1);
      if (!job) break;
      this.activeCount += 1;
      this.activeTraceIds.add(job.message.traceId);
      void this.deliver(job).finally(() => {
        this.activeCount -= 1;
        this.activeTraceIds.delete(job.message.traceId);
        this.pump();
        this.notifyIfDrained();
      });
    }
  }

  private async deliver(job: BridgeDeliveryJob): Promise<void> {
    try {
      await publishToMq({
        api: this.api,
        config: this.config,
        channelConfig: job.channelConfig,
        sourceChannel: job.sourceChannel,
        direction: job.direction,
        message: job.message,
        signal: this.abortController.signal,
      });
    } catch (error) {
      // 外部 adapter 的异常只能以脱敏摘要进入 Gateway 日志。
      const reason = redactBridgeError(error);
      this.api.logger.error(
        `[openclaw-bridge] delivery failed messageId=${job.message.messageId} ` +
        `channel=${job.sourceChannel} direction=${job.direction}: ${reason}`,
      );
    }
  }

  private isDrained(): boolean {
    return this.queue.length === 0 && this.activeCount === 0;
  }

  private waitUntilDrained(): Promise<void> {
    if (this.isDrained()) return Promise.resolve();
    return new Promise((resolve) => this.drainWaiters.add(resolve));
  }

  private notifyIfDrained(): void {
    if (!this.isDrained()) return;
    for (const resolve of this.drainWaiters) resolve();
    this.drainWaiters.clear();
  }
}

function stableMessageId(direction: "inbound" | "outbound", channel: string, identity: string): string {
  const digest = createHash("sha256").update(`${direction}:${channel}:${identity}`).digest("hex");
  return `bridge/${direction === "inbound" ? "in" : "out"}/${safeSegment(channel)}/${digest}`;
}

class ReplyOrdinalTracker {
  private readonly ordinals = new Map<string, number>();

  next(runIdentity: string): number {
    const value = this.ordinals.get(runIdentity) ?? 0;
    this.ordinals.set(runIdentity, value + 1);
    if (this.ordinals.size > 10_000) this.ordinals.delete(this.ordinals.keys().next().value as string);
    return value;
  }
}

/**
 * @description 注册 `message_received` 与 `message_sent`：按配置将真实收发载荷转发到 MQ。
 *
 * **处理流程**：
 * 1. 校验 `channelId`、渠道配置、`getChannelMeta` 闸门
 * 2. 从真实入站或回复 payload 提取正文并生成稳定投递 ID
 * 3. 通过公共 outbound adapter 发布 inbound/outbound topic
 *
 * @param api - OpenClaw 插件 API（`on`、`publishInbound`、`logger`）。
 * @returns void
 * @throws 不抛出同步异常；publish 失败仅记录 error 日志。
 */
export function registerMessageBridge(api: OpenClawPluginApi): void {
  const config = getConfig(api);
  validateBridgeConfig(config);
  const dispatcher = new BridgeDeliveryDispatcher(api, config, resolveDelivery(config));
  const replyOrdinals = new ReplyOrdinalTracker();

  api.on("message_received", (event, ctx) => {
    const channelId = ctx.channelId;
    const channelConfig = config.channels?.[channelId];
    if (!channelConfig || channelConfig.enabled === false || channelConfig.forwardToMq === false) return;
    const text = extractText(event.content);
    if (!text) return;
    const sessionKey = ctx.sessionKey ?? event.sessionKey ?? ctx.conversationId ?? "";
    const accountId = ctx.accountId ?? "default";
    const identity = ctx.messageId ?? event.messageId ?? ctx.runId ?? event.runId ?? randomUUID();
    const message = buildMessage({
      channel: channelId,
      accountId,
      agentId: "default",
      sessionKey,
      userId: ctx.senderId ?? event.senderId ?? event.from ?? "unknown",
      text,
      messageId: stableMessageId("inbound", channelId, `${accountId}:${sessionKey}:${identity}`),
      traceId: readString(event.traceId) ?? deriveTraceId(channelId, accountId, "default", sessionKey),
      timestamp: event.timestamp,
      metadata: { sessionKey, runId: ctx.runId ?? event.runId, sourceChannel: channelId, bridge: "openclaw-bridge", direction: "inbound" },
    });
    dispatcher.enqueue({ channelConfig, sourceChannel: channelId, direction: "inbound", message });
  });

  api.on("message_sent", (event, ctx) => {
    const channelId = ctx.channelId;
    const channelConfig = config.channels?.[channelId];
    if (!channelConfig || channelConfig.enabled === false || channelConfig.forwardToMq === false) return;
    if (isBridgeAuditTarget(event.to, channelId, channelConfig)) return;
    // `message_sent` 位于公共 outbound delivery 之后，只有 success=true 才代表平台已接受该消息。
    if (!event.success) {
      api.logger.warn(
        `[openclaw-bridge] source delivery failed; skip outbound mirror channel=${channelId} error=${redactBridgeError(event.error ?? "unknown")}`,
      );
      return;
    }
    const text = extractText(event.content);
    if (!text) return;
    const sessionKey = ctx.sessionKey ?? event.sessionKey ?? ctx.conversationId ?? event.to ?? "";
    const accountId = ctx.accountId ?? "default";
    const deliveryIdentity = event.messageId ?? ctx.messageId ?? event.runId ?? ctx.runId ?? randomUUID();
    const ordinal = replyOrdinals.next(`${channelId}:${accountId}:${sessionKey}:${deliveryIdentity}`);
    const message = buildMessage({
      channel: channelId,
      accountId,
      agentId: "default",
      sessionKey,
      userId: event.to ?? ctx.conversationId ?? "unknown",
      text,
      direction: "outbound",
      messageId: stableMessageId("outbound", channelId, `${accountId}:${sessionKey}:${deliveryIdentity}:${ordinal}`),
      traceId: readString(event.traceId) ?? readString(ctx.traceId) ?? deriveTraceId(channelId, accountId, "default", sessionKey),
      metadata: { sessionKey, runId: event.runId ?? ctx.runId, platformMessageId: event.messageId, ordinal, sourceChannel: channelId, bridge: "openclaw-bridge", direction: "outbound", success: true },
    });
    dispatcher.enqueue({ channelConfig, sourceChannel: channelId, direction: "outbound", message });
  });

  api.registerService({
    id: "openclaw-bridge-delivery",
    start: () => dispatcher.start(),
    stop: async () => {
      await dispatcher.stop();
      clearBridgeRuntime();
    },
  });

  api.logger.info("[openclaw-bridge] Message bridge registered with bounded background delivery");
}
