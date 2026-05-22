/**
 * FIFO queue for inbound UnifiedMessage items inside one Gateway process.
 *
 * `push` can optionally use an idempotency cache. When the key was already
 * seen, the item is not queued and `false` is returned.
 *
 * 该队列只表达 SDK 内部的轻量入站排队语义，不负责持久化、重试或跨进程锁。
 * 需要跨进程去重时应组合 `dedup/persistent-dedupe` 或 `claimable-dedupe`。
 */

import type { UnifiedMessage } from "../core/types.js";
import type { IdempotencyCache } from "../dedup/idempotency-cache.js";

/**
 * 入站消息入队参数。
 *
 * @property message - 已归一化的 UnifiedMessage。
 * @property idempotencyKey - 可选幂等 key；未提供时使用 `message.messageId`。
 * @property transportMeta - 原传输层元数据，供后续派发或审计使用。
 */
export interface InboundPushParams {
  message: UnifiedMessage;
  idempotencyKey?: string;
  transportMeta?: Record<string, unknown>;
}

/**
 * 入队后的同步/异步处理器。
 *
 * @param item - 刚进入队列的消息条目；处理器可以立即派发，也可以只做审计。
 */
export type InboundQueueHandler = (item: InboundQueueItem) => void | Promise<void>;

/**
 * 队列内部保存的入站消息条目。
 *
 * @property message - 入站统一消息。
 * @property transportMeta - 可选原始传输元数据。
 * @property pushedAt - 入队时间戳，单位毫秒。
 */
export interface InboundQueueItem {
  message: UnifiedMessage;
  transportMeta?: Record<string, unknown>;
  pushedAt: number;
}

/**
 * 入站队列配置。
 *
 * @property idempotency - 可选内存幂等缓存，用于拒绝重复 messageId/key。
 * @property onPush - 入队后立即触发的处理器。
 */
export interface InboundMessageQueueOptions {
  idempotency?: IdempotencyCache;
  onPush?: InboundQueueHandler;
}

/**
 * 单进程 FIFO 入站队列。
 *
 * 适合在插件进程内短暂缓冲消息，或在测试中锁定“入队后再派发”的顺序。
 * 该类不是持久队列；进程退出后队列内容会丢失。
 */
export class InboundMessageQueue {
  private readonly queue: InboundQueueItem[] = [];
  private readonly idempotency?: IdempotencyCache;
  private readonly onPush?: InboundQueueHandler;

  /**
   * 创建一个入站队列实例。
   *
   * @param options - 幂等缓存和入队处理器配置。
   */
  constructor(options: InboundMessageQueueOptions = {}) {
    this.idempotency = options.idempotency;
    this.onPush = options.onPush;
  }

  /**
   * 将消息放入队列，并在需要时触发 onPush。
   *
   * @param params - 入队消息、幂等 key 和传输元数据。
   * @returns `true` 表示消息被接受；`false` 表示被幂等缓存判定为重复。
   */
  async push(params: InboundPushParams): Promise<boolean> {
    const key = params.idempotencyKey ?? params.message.messageId;
    if (this.idempotency?.remember(key)) {
      return false;
    }

    const item: InboundQueueItem = {
      message: params.message,
      transportMeta: params.transportMeta,
      pushedAt: Date.now(),
    };
    this.queue.push(item);

    if (this.onPush) {
      await this.onPush(item);
    }
    return true;
  }

  /**
   * 取出最早入队的消息。
   *
   * @returns 队首条目；队列为空时返回 `undefined`。
   */
  pop(): InboundQueueItem | undefined {
    return this.queue.shift();
  }

  /**
   * 查看队首消息但不移除。
   *
   * @returns 队首条目；队列为空时返回 `undefined`。
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

  /**
   * 清空当前进程内的待处理消息。
   */
  clear(): void {
    this.queue.length = 0;
  }
}
