/**
 * @module queue/inbound-message-queue
 *
 * Gateway 进程内 UnifiedMessage 的 FIFO 入站队列。
 *
 * **职责**：单进程轻量缓冲入站消息；可选组合内存幂等缓存拒绝重复 messageId。
 *
 * **适用场景**：插件进程内「先入队再派发」的顺序控制；跨进程去重应组合 `dedup/persistent-dedupe`
 * 或 `claimable-dedupe`。
 *
 * **关键导出**：`InboundMessageQueue`、`InboundPushResult`、`InboundMessageQueueCapacityError`
 */

import type { UnifiedMessage } from "../core/types.js";
import type { IdempotencyCache } from "../dedup/idempotency-cache.js";

const DEFAULT_MAX_QUEUE_SIZE = 10_000;

/**
 * 入站消息入队参数。
 *
 * @property message - 已归一化的 UnifiedMessage
 * @property idempotencyKey - 可选幂等 key；未提供时使用 `message.messageId`
 * @property transportMeta - 原传输层元数据，供后续派发或审计使用
 */
export interface InboundPushParams {
  message: UnifiedMessage;
  idempotencyKey?: string;
  transportMeta?: Record<string, unknown>;
}

/**
 * 入队后的同步/异步处理器。
 *
 * @param item - 刚进入队列的消息条目；处理器可以立即派发，也可以只做审计
 */
export type InboundQueueHandler = (item: InboundQueueItem) => void | Promise<void>;

/**
 * 精确的入队结果。
 *
 * `duplicate` 可以安全确认消费；`full` 必须告警、重试或反压，二者不能混为一谈。
 */
export type InboundPushResult = "accepted" | "duplicate" | "full";

/**
 * 队列内部保存的入站消息条目。
 *
 * @property message - 入站统一消息
 * @property transportMeta - 可选原始传输元数据
 * @property pushedAt - 入队时间戳（毫秒）
 */
export interface InboundQueueItem {
  message: UnifiedMessage;
  transportMeta?: Record<string, unknown>;
  pushedAt: number;
}

/**
 * 入站队列配置。
 *
 * @property idempotency - 可选内存幂等缓存，用于拒绝重复 messageId/key
 * @property onPush - 入队后立即触发的处理器
 * @property maxSize - 队列最大容量（默认 10_000）；超出时 push 返回 false
 * @property onOverflow - 队列满时的观测回调；回调失败不会改变入队结果
 */
export interface InboundMessageQueueOptions {
  idempotency?: IdempotencyCache;
  onPush?: InboundQueueHandler;
  maxSize?: number;
  onOverflow?: (info: { params: InboundPushParams; size: number; maxSize: number }) =>
    | void
    | Promise<void>;
}

/** 入站队列已满；消费者应重试或触发上游反压，不能把它当作重复消息确认。 */
export class InboundMessageQueueCapacityError extends Error {
  constructor(public readonly maxSize: number) {
    super(`InboundMessageQueue capacity exceeded (maxSize=${maxSize})`);
    this.name = "InboundMessageQueueCapacityError";
  }
}

/**
 * 单进程 FIFO 入站队列。
 *
 * 适合在插件进程内短暂缓冲消息，或在测试中锁定「入队后再派发」的顺序。
 * 该类不是持久队列；进程退出后队列内容会丢失。
 *
 * @example
 * ```ts
 * const queue = new InboundMessageQueue({
 *   idempotency: createIdempotencyCache({ ttlMs: 60_000, maxEntries: 10_000 }),
 *   onPush: (item) => dispatchToAgent(item),
 * });
 * const accepted = await queue.push({ message });
 * ```
 */
export class InboundMessageQueue {
  private readonly queue: InboundQueueItem[] = [];
  private readonly idempotency?: IdempotencyCache;
  private readonly onPush?: InboundQueueHandler;
  private readonly onOverflow?: InboundMessageQueueOptions["onOverflow"];
  private readonly maxSize: number;

  /**
   * 创建一个入站队列实例。
   *
   * @param options - 幂等缓存和入队处理器配置
   */
  constructor(options: InboundMessageQueueOptions = {}) {
    const maxSize = options.maxSize ?? DEFAULT_MAX_QUEUE_SIZE;
    if (!Number.isSafeInteger(maxSize) || maxSize < 1) {
      throw new Error("InboundMessageQueue maxSize must be a positive safe integer");
    }
    this.idempotency = options.idempotency;
    this.onPush = options.onPush;
    this.onOverflow = options.onOverflow;
    this.maxSize = maxSize;
  }

  /**
   * 将消息放入队列，并在需要时触发 onPush。
   *
   * 兼容布尔返回值的便捷入口。需要区分「重复」和「队列已满」时应调用 `pushDetailed`。
   *
   * @param params - 入队消息、幂等 key 和传输元数据
   * @returns `true` 表示消息被接受；`false` 表示重复或队列已满
   */
  async push(params: InboundPushParams): Promise<boolean> {
    return (await this.pushDetailed(params)) === "accepted";
  }

  /**
   * 将消息原子地入队，并返回可用于消费确认决策的精确结果。
   *
   * 容量检查必须早于幂等 key 占位，否则队列满时会污染 key，后续合法重试也会被误判为重复。
   */
  async pushDetailed(params: InboundPushParams): Promise<InboundPushResult> {
    if (this.queue.length >= this.maxSize) {
      if (this.onOverflow) {
        try {
          void Promise.resolve(
            this.onOverflow({ params, size: this.queue.length, maxSize: this.maxSize }),
          ).catch(() => undefined);
        } catch {
          // 指标或告警失败不能反向改变队列的容量语义。
        }
      }
      return "full";
    }

    const key = params.idempotencyKey ?? params.message.messageId;
    if (this.idempotency?.remember(key)) {
      return "duplicate";
    }

    const item: InboundQueueItem = {
      message: params.message,
      transportMeta: params.transportMeta,
      pushedAt: Date.now(),
    };
    this.queue.push(item);

    if (this.onPush) {
      try {
        await this.onPush(item);
      } catch (error) {
        // 对调用方保持原子性：即时处理失败时既不留下幽灵条目，也不阻断后续重试。
        const index = this.queue.indexOf(item);
        if (index >= 0) this.queue.splice(index, 1);
        this.idempotency?.forget(key);
        throw error;
      }
    }
    return "accepted";
  }

  /**
   * 取出最早入队的消息（FIFO）。
   *
   * @returns 队首条目；队列为空时返回 `undefined`
   */
  pop(): InboundQueueItem | undefined {
    return this.queue.shift();
  }

  /**
   * 查看队首消息但不移除。
   *
   * @returns 队首条目；队列为空时返回 `undefined`
   */
  peek(): InboundQueueItem | undefined {
    return this.queue[0];
  }

  /**
   * 当前等待处理的消息数量。
   */
  get size(): number {
    return this.queue.length;
  }

  /** 配置的容量上限，供派发层生成明确的反压错误与指标标签。 */
  get maxCapacity(): number {
    return this.maxSize;
  }

  /**
   * 清空当前进程内的待处理消息。
   */
  clear(): void {
    this.queue.length = 0;
  }
}
