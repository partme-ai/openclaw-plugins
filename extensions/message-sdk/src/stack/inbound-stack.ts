/**
 * 入站消息栈：push → 可选去重 → 消费。
 */

import type { UnifiedMessage } from "../core/types.js";
import type { IdempotencyCache } from "../dedup/idempotency-cache.js";

export interface InboundPushParams {
  message: UnifiedMessage;
  idempotencyKey?: string;
  transportMeta?: Record<string, unknown>;
}

export type InboundStackHandler = (item: InboundStackItem) => void | Promise<void>;

export interface InboundStackItem {
  message: UnifiedMessage;
  transportMeta?: Record<string, unknown>;
  pushedAt: number;
}

export interface InboundMessageStackOptions {
  idempotency?: IdempotencyCache;
  onPush?: InboundStackHandler;
}

/**
 * 内存入站栈（单进程 Gateway 内使用）。
 */
export class InboundMessageStack {
  private readonly queue: InboundStackItem[] = [];
  private readonly idempotency?: IdempotencyCache;
  private readonly onPush?: InboundStackHandler;

  constructor(options: InboundMessageStackOptions = {}) {
    this.idempotency = options.idempotency;
    this.onPush = options.onPush;
  }

  /**
   * 入栈；若幂等 key 重复则跳过并返回 false。
   */
  async push(params: InboundPushParams): Promise<boolean> {
    const key = params.idempotencyKey ?? params.message.messageId;
    if (this.idempotency?.remember(key)) {
      return false;
    }

    const item: InboundStackItem = {
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

  /** 出栈（FIFO）。 */
  pop(): InboundStackItem | undefined {
    return this.queue.shift();
  }

  peek(): InboundStackItem | undefined {
    return this.queue[0];
  }

  get size(): number {
    return this.queue.length;
  }

  clear(): void {
    this.queue.length = 0;
  }
}
