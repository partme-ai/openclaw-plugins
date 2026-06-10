/**
 * @module queue/stream-session-store
 *
 * StreamSessionStore — 流式会话状态、msgid 去重、防抖聚合与 per-conversation 批次排队（渠道无关）。
 *
 * **职责**：
 * - 管理 stream 生命周期（create / update / started / finished）
 * - msgid → streamId 映射去重
 * - 同一会话 burst 消息的 debounce 合并（active / queued 批次）
 * - stream 完成后推进 conversation 队列
 * - TTL prune 清理过期 stream / pending / conversation 状态
 *
 * **适用场景**：WeCom / Feishu 等「先 ACK 再流式推送」的 webhook 入站链路。
 *
 * **上下游**：
 * - 上游：Webhook 解析出的 msgid、conversationKey、消息内容
 * - 下游：`onFlush` 回调触发 Agent 派发；`StreamSessionMonitor` 统一管理 prune
 *
 * **关键导出**：`StreamSessionStore`、`StreamSessionMonitor`、`STREAM_SESSION_LIMITS`
 */

import crypto from "node:crypto";

import { ActiveReplyStore } from "../ingress/active-reply-store.js";

/** Stream 会话 TTL 与默认 debounce 常量。 */
export const STREAM_SESSION_LIMITS = {
  /** 流式会话状态过期时间（10 分钟）。 */
  STREAM_TTL_MS: 10 * 60 * 1000,
  /** 入站 burst 默认 debounce 间隔（500ms）。 */
  DEFAULT_DEBOUNCE_MS: 500,
} as const;

/**
 * 流式会话基础状态（渠道可扩展 media、wsMode 等字段）。
 *
 * @property streamId - 唯一流 ID
 * @property msgid - 平台消息 ID（可选）
 * @property conversationKey - 会话 key
 * @property batchKey - 批次 key（active 时为 conversationKey，queued 时为 conversationKey#qN）
 * @property createdAt - 创建时间戳
 * @property updatedAt - 最后更新时间戳
 * @property started - Agent 是否已开始处理
 * @property finished - 流是否已结束
 * @property content - 累积的流式内容
 */
export type BaseStreamSessionState = {
  streamId: string;
  msgid?: string;
  conversationKey?: string;
  batchKey?: string;
  createdAt: number;
  updatedAt: number;
  started: boolean;
  finished: boolean;
  content: string;
};

/**
 * `addPendingMessage` 返回的状态，描述消息进入 active 或 queued 批次的结果。
 *
 * - `active_new` — 新建 active 批次（会话首条消息）
 * - `active_merged` — 合并进当前 active 批次（debounce 重置）
 * - `queued_new` — 新建 queued 批次（active 已开始处理）
 * - `queued_merged` — 合并进队首 queued 批次
 */
export type PendingInboundStatus = "active_new" | "active_merged" | "queued_new" | "queued_merged";

/**
 * 防抖待处理消息基础结构（渠道可扩展 media、wsMode 等）。
 *
 * @property streamId - 关联的 stream ID
 * @property conversationKey - 会话 key
 * @property batchKey - 批次 key
 * @property target - 投递目标（渠道自定义）
 * @property msg - 原始消息对象
 * @property contents - 合并后的文本片段列表
 * @property msgids - 合并后的 msgid 列表
 * @property nonce - webhook nonce
 * @property timestamp - 消息时间戳
 * @property timeout - debounce 定时器句柄
 * @property readyToFlush - 非 active 批次 timer 到期后标记，待 stream 完成后 flush
 * @property createdAt - 批次创建时间（用于 TTL prune）
 */
export type BasePendingInbound<TTarget, TMsg> = {
  streamId: string;
  conversationKey: string;
  batchKey: string;
  target: TTarget;
  msg: TMsg;
  contents: string[];
  msgids: string[];
  nonce: string;
  timestamp: string;
  timeout: ReturnType<typeof setTimeout> | null;
  readyToFlush?: boolean;
  createdAt: number;
};

/**
 * StreamSessionStore 构造选项。
 *
 * @property createStreamState - 自定义 stream 状态工厂
 * @property streamTtlMs - stream / pending TTL，默认 `STREAM_SESSION_LIMITS.STREAM_TTL_MS`
 * @property defaultDebounceMs - 默认 debounce 间隔，默认 `STREAM_SESSION_LIMITS.DEFAULT_DEBOUNCE_MS`
 */
export type StreamSessionStoreOptions<TStream extends BaseStreamSessionState> = {
  createStreamState?: (params: {
    streamId: string;
    msgid?: string;
    conversationKey?: string;
    batchKey?: string;
  }) => TStream;
  streamTtlMs?: number;
  defaultDebounceMs?: number;
};

/** 每个 conversation 的 active 批次与 queued 批次队列状态。 */
type ConversationState = {
  activeBatchKey: string;
  queue: string[];
  nextSeq: number;
};

/**
 * **StreamSessionStore (流状态会话存储)**
 *
 * 管理流式会话状态、msgid 去重、debounce 聚合与 per-conversation 批次排队。
 *
 * @example
 * ```ts
 * const store = new StreamSessionStore();
 * store.setFlushHandler((pending) => dispatchAgent(pending));
 * const { streamId, status } = store.addPendingMessage({
 *   conversationKey: "acc1:user1",
 *   target, msg, msgContent: "hello", nonce, timestamp,
 * });
 * ```
 */
export class StreamSessionStore<
  TTarget,
  TMsg,
  TStream extends BaseStreamSessionState = BaseStreamSessionState,
> {
  private streams = new Map<string, TStream>();
  private msgidToStreamId = new Map<string, string>();
  private pendingInbounds = new Map<string, BasePendingInbound<TTarget, TMsg>>();
  private conversationState = new Map<string, ConversationState>();
  private streamIdToBatchKey = new Map<string, string>();
  private batchStreamIdToAckStreamIds = new Map<string, string[]>();
  private onFlush?: (pending: BasePendingInbound<TTarget, TMsg>) => void;

  private readonly streamTtlMs: number;
  private readonly defaultDebounceMs: number;
  private readonly createStreamState: (params: {
    streamId: string;
    msgid?: string;
    conversationKey?: string;
    batchKey?: string;
  }) => TStream;

  /**
   * 创建 StreamSessionStore 实例。
   *
   * @param options - TTL、debounce 与 stream 状态工厂
   */
  constructor(options: StreamSessionStoreOptions<TStream> = {}) {
    this.streamTtlMs = options.streamTtlMs ?? STREAM_SESSION_LIMITS.STREAM_TTL_MS;
    this.defaultDebounceMs = options.defaultDebounceMs ?? STREAM_SESSION_LIMITS.DEFAULT_DEBOUNCE_MS;
    this.createStreamState =
      options.createStreamState ??
      ((params) =>
        ({
          streamId: params.streamId,
          msgid: params.msgid,
          conversationKey: params.conversationKey,
          batchKey: params.batchKey,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          started: false,
          finished: false,
          content: "",
        }) as TStream);
  }

  /**
   * 设置 debounce 到期后的 flush 回调。
   *
   * @param handler - 收到合并后的 pending 批次时调用
   */
  setFlushHandler(handler: (pending: BasePendingInbound<TTarget, TMsg>) => void): void {
    this.onFlush = handler;
  }

  /**
   * 创建流会话并返回 streamId。
   *
   * @param params.msgid - 可选；写入 msgid → streamId 映射
   * @param params.conversationKey - 会话 key
   * @param params.batchKey - 批次 key
   * @returns 新生成的 streamId
   */
  createStream(params: { msgid?: string; conversationKey?: string; batchKey?: string }): string {
    const streamId = crypto.randomBytes(16).toString("hex");

    if (params.msgid) {
      this.msgidToStreamId.set(String(params.msgid), streamId);
    }

    this.streams.set(
      streamId,
      this.createStreamState({
        streamId,
        msgid: params.msgid,
        conversationKey: params.conversationKey,
        batchKey: params.batchKey,
      }),
    );

    if (params.batchKey) {
      this.streamIdToBatchKey.set(streamId, params.batchKey);
    }

    return streamId;
  }

  /**
   * 按 streamId 获取流状态。
   *
   * @param streamId - 流 ID
   * @returns 流状态；不存在时 undefined
   */
  getStream(streamId: string): TStream | undefined {
    return this.streams.get(streamId);
  }

  /**
   * 按 msgid 反查 streamId。
   *
   * @param msgid - 平台消息 ID
   * @returns 关联的 streamId；未映射时 undefined
   */
  getStreamByMsgId(msgid: string): string | undefined {
    return this.msgidToStreamId.get(String(msgid));
  }

  /**
   * 手动设置 msgid → streamId 映射（补录或测试用）。
   *
   * @param msgid - 平台消息 ID
   * @param streamId - 流 ID
   */
  setStreamIdForMsgId(msgid: string, streamId: string): void {
    const key = String(msgid).trim();
    const value = String(streamId).trim();
    if (!key || !value) return;
    this.msgidToStreamId.set(key, value);
  }

  /**
   * 将回执流（ack stream）关联到批次流（batch stream）。
   *
   * @param params.batchStreamId - 主批次 stream ID
   * @param params.ackStreamId - 回执 stream ID
   */
  addAckStreamForBatch(params: { batchStreamId: string; ackStreamId: string }): void {
    const batchStreamId = params.batchStreamId.trim();
    const ackStreamId = params.ackStreamId.trim();
    if (!batchStreamId || !ackStreamId) return;
    const list = this.batchStreamIdToAckStreamIds.get(batchStreamId) ?? [];
    list.push(ackStreamId);
    this.batchStreamIdToAckStreamIds.set(batchStreamId, list);
  }

  /**
   * 取出并清空某个批次流关联的所有回执流 ID。
   *
   * @param batchStreamId - 批次 stream ID
   * @returns 回执 stream ID 列表
   */
  drainAckStreamsForBatch(batchStreamId: string): string[] {
    const key = batchStreamId.trim();
    if (!key) return [];
    const list = this.batchStreamIdToAckStreamIds.get(key) ?? [];
    this.batchStreamIdToAckStreamIds.delete(key);
    return list;
  }

  /**
   * 原地更新流状态并刷新 updatedAt。
   *
   * @param streamId - 流 ID
   * @param mutator - 状态变更函数
   */
  updateStream(streamId: string, mutator: (state: TStream) => void): void {
    const state = this.streams.get(streamId);
    if (state) {
      mutator(state);
      state.updatedAt = Date.now();
    }
  }

  /**
   * 标记流已开始处理（Agent 已启动）。
   *
   * @param streamId - 流 ID
   */
  markStarted(streamId: string): void {
    this.updateStream(streamId, (s) => {
      s.started = true;
    });
  }

  /**
   * 标记流已结束。
   *
   * @param streamId - 流 ID
   */
  markFinished(streamId: string): void {
    this.updateStream(streamId, (s) => {
      s.finished = true;
    });
  }

  /**
   * 添加入站消息到 debounce 缓冲，按 conversation 分 active / queued 批次。
   *
   * **Debounce 语义**：每次新消息重置该 batch 的 timer；静默 debounceMs 后触发 flush。
   * **Queue 语义**：active 批次已开始处理时，新消息进入 queued 批次；stream 完成后由
   * `onStreamFinished` 推进队列。
   *
   * @param params.conversationKey - 会话 key
   * @param params.target - 投递目标
   * @param params.msg - 原始消息（可含 msgid）
   * @param params.msgContent - 文本内容
   * @param params.nonce - webhook nonce
   * @param params.timestamp - 消息时间戳
   * @param params.debounceMs - 可选 debounce 间隔，默认实例配置
   * @returns streamId 与入队状态
   */
  addPendingMessage(params: {
    conversationKey: string;
    target: TTarget;
    msg: TMsg;
    msgContent: string;
    nonce: string;
    timestamp: string;
    debounceMs?: number;
  }): { streamId: string; status: PendingInboundStatus } {
    const { conversationKey, target, msg, msgContent, nonce, timestamp, debounceMs } = params;
    const msgid = (msg as { msgid?: string }).msgid;
    const effectiveDebounceMs = debounceMs ?? this.defaultDebounceMs;

    const state = this.conversationState.get(conversationKey);
    // 会话首条消息：创建 active 批次（batchKey === conversationKey）
    if (!state) {
      const batchKey = conversationKey;
      const streamId = this.createStream({ msgid, conversationKey, batchKey });
      const pending: BasePendingInbound<TTarget, TMsg> = {
        streamId,
        conversationKey,
        batchKey,
        target,
        msg,
        contents: [msgContent],
        msgids: msgid ? [msgid] : [],
        nonce,
        timestamp,
        createdAt: Date.now(),
        timeout: setTimeout(() => {
          this.requestFlush(batchKey);
        }, effectiveDebounceMs),
      };
      this.pendingInbounds.set(batchKey, pending);
      this.conversationState.set(conversationKey, { activeBatchKey: batchKey, queue: [], nextSeq: 1 });
      return { streamId, status: "active_new" };
    }

    const activeBatchKey = state.activeBatchKey;
    const activeIsInitial = activeBatchKey === conversationKey;
    const activePending = this.pendingInbounds.get(activeBatchKey);
    // active 批次尚未 started：合并进 active 并重置 debounce timer
    if (activePending && !activeIsInitial) {
      const activeStream = this.streams.get(activePending.streamId);
      const activeStarted = Boolean(activeStream?.started);
      if (!activeStarted) {
        activePending.contents.push(msgContent);
        if (msgid) {
          activePending.msgids.push(msgid);
        }
        if (activePending.timeout) clearTimeout(activePending.timeout);
        activePending.timeout = setTimeout(() => {
          this.requestFlush(activeBatchKey);
        }, effectiveDebounceMs);
        return { streamId: activePending.streamId, status: "active_merged" };
      }
    }

    const queuedBatchKey = state.queue[0];
    // 已有 queued 批次：合并队首并重置 timer
    if (queuedBatchKey) {
      const existingQueued = this.pendingInbounds.get(queuedBatchKey);
      if (existingQueued) {
        existingQueued.contents.push(msgContent);
        if (msgid) {
          existingQueued.msgids.push(msgid);
        }
        if (existingQueued.timeout) clearTimeout(existingQueued.timeout);

        existingQueued.timeout = setTimeout(() => {
          this.requestFlush(queuedBatchKey);
        }, effectiveDebounceMs);
        return { streamId: existingQueued.streamId, status: "queued_merged" };
      }
    }

    // active 已开始：创建新 queued 批次（conversationKey#qN）
    const seq = state.nextSeq++;
    const batchKey = `${conversationKey}#q${seq}`;
    state.queue = [batchKey];
    const streamId = this.createStream({ msgid, conversationKey, batchKey });
    const pending: BasePendingInbound<TTarget, TMsg> = {
      streamId,
      conversationKey,
      batchKey,
      target,
      msg,
      contents: [msgContent],
      msgids: msgid ? [msgid] : [],
      nonce,
      timestamp,
      createdAt: Date.now(),
      timeout: setTimeout(() => {
        this.requestFlush(batchKey);
      }, effectiveDebounceMs),
    };
    this.pendingInbounds.set(batchKey, pending);
    this.conversationState.set(conversationKey, state);
    return { streamId, status: "queued_new" };
  }

  /**
   * debounce timer 到期时的 flush 请求。
   * 非 active 批次只标记 readyToFlush，等 active stream 完成后由 onStreamFinished 触发。
   */
  private requestFlush(batchKey: string): void {
    const pending = this.pendingInbounds.get(batchKey);
    if (!pending) return;

    const state = this.conversationState.get(pending.conversationKey);
    const isActive = state?.activeBatchKey === batchKey;
    if (!isActive) {
      if (pending.timeout) {
        clearTimeout(pending.timeout);
        pending.timeout = null;
      }
      pending.readyToFlush = true;
      return;
    }
    this.flushPending(batchKey);
  }

  /** 立即 flush 指定 batch，调用 onFlush 并清理 pending。 */
  private flushPending(pendingKey: string): void {
    const pending = this.pendingInbounds.get(pendingKey);
    if (!pending) return;

    this.pendingInbounds.delete(pendingKey);
    if (pending.timeout) {
      clearTimeout(pending.timeout);
      pending.timeout = null;
    }
    pending.readyToFlush = false;

    if (this.onFlush) {
      this.onFlush(pending);
    }
  }

  /**
   * stream 完成后推进 conversation 队列：将下一个 queued 批次提升为 active 并 flush。
   *
   * @param streamId - 已完成的 stream ID
   */
  onStreamFinished(streamId: string): void {
    const batchKey = this.streamIdToBatchKey.get(streamId);
    const state = batchKey ? this.streams.get(streamId) : undefined;
    const conversationKey = state?.conversationKey;
    if (!batchKey || !conversationKey) return;

    const conv = this.conversationState.get(conversationKey);
    if (!conv) return;
    if (conv.activeBatchKey !== batchKey) return;

    const next = conv.queue.shift();
    if (!next) {
      this.conversationState.delete(conversationKey);
      return;
    }
    conv.activeBatchKey = next;
    this.conversationState.set(conversationKey, conv);

    const pending = this.pendingInbounds.get(next);
    if (!pending) return;
    if (pending.readyToFlush) {
      this.flushPending(next);
    }
  }

  /**
   * 按 TTL 清理过期 stream、msgid 映射、pending 批次与空 conversation 状态。
   *
   * @param now - 当前时间戳，默认 `Date.now()`
   */
  prune(now: number = Date.now()): void {
    const streamCutoff = now - this.streamTtlMs;

    // TTL：删除 updatedAt 超过 streamTtlMs 的 stream
    for (const [id, streamState] of this.streams.entries()) {
      if (streamState.updatedAt < streamCutoff) {
        this.streams.delete(id);
        if (streamState.msgid) {
          if (this.msgidToStreamId.get(streamState.msgid) === id) {
            this.msgidToStreamId.delete(streamState.msgid);
          }
        }
      }
    }

    // 清理指向已删除 stream 的 msgid 映射
    for (const [msgid, id] of this.msgidToStreamId.entries()) {
      if (!this.streams.has(id)) {
        this.msgidToStreamId.delete(msgid);
      }
    }

    // TTL：删除 createdAt 超过 streamTtlMs 的 pending 批次
    for (const [key, pending] of this.pendingInbounds.entries()) {
      if (now - pending.createdAt > this.streamTtlMs) {
        if (pending.timeout) clearTimeout(pending.timeout);
        this.pendingInbounds.delete(key);
      }
    }

    // 清理无 active pending 且无 queue 的 conversation 状态
    for (const [convKey, conv] of this.conversationState.entries()) {
      const activeExists =
        this.pendingInbounds.has(conv.activeBatchKey) ||
        Array.from(this.streamIdToBatchKey.values()).includes(conv.activeBatchKey);
      const hasQueue = conv.queue.length > 0;
      if (!activeExists && !hasQueue) {
        this.conversationState.delete(convKey);
      }
    }
  }
}

/**
 * **StreamSessionMonitor (流会话监控容器)**
 *
 * 统一管理 StreamSessionStore 与 ActiveReplyStore，并提供定期 prune 定时器。
 *
 * @example
 * ```ts
 * const monitor = new StreamSessionMonitor({
 *   streamStore: new StreamSessionStore(),
 *   activeReplyPolicy: "once",
 * });
 * monitor.startPruning(60_000);
 * // shutdown: monitor.stopPruning();
 * ```
 */
export class StreamSessionMonitor<
  TTarget,
  TMsg,
  TStream extends BaseStreamSessionState = BaseStreamSessionState,
> {
  public readonly streamStore: StreamSessionStore<TTarget, TMsg, TStream>;
  public readonly activeReplyStore: ActiveReplyStore;

  private pruneInterval?: NodeJS.Timeout;

  /**
   * 创建监控容器。
   *
   * @param options.streamStore - 流会话存储实例
   * @param options.activeReplyPolicy - ActiveReply 使用策略，默认 `multi`
   */
  constructor(options: {
    streamStore: StreamSessionStore<TTarget, TMsg, TStream>;
    activeReplyPolicy?: "once" | "multi";
  }) {
    this.streamStore = options.streamStore;
    this.activeReplyStore = new ActiveReplyStore(options.activeReplyPolicy ?? "multi");
  }

  /**
   * 启动定期 prune 定时器（stream + activeReply TTL 清理）。
   *
   * @param intervalMs - prune 间隔，默认 60_000ms
   */
  startPruning(intervalMs: number = 60_000): void {
    if (this.pruneInterval) return;
    this.pruneInterval = setInterval(() => {
      const now = Date.now();
      this.streamStore.prune(now);
      this.activeReplyStore.prune(now);
    }, intervalMs);
  }

  /**
   * 停止定期 prune 定时器。
   */
  stopPruning(): void {
    if (this.pruneInterval) {
      clearInterval(this.pruneInterval);
      this.pruneInterval = undefined;
    }
  }
}
