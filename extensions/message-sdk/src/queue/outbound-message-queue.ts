/**
 * @module queue/outbound-message-queue
 *
 * 按 sessionKey 分组的 FIFO 出站消息队列（单进程内存结构）。
 *
 * **职责**：缓存 Agent 产出的回复，按 OpenClaw 会话 key 分组，支持 push / pop / peek / clear。
 *
 * **适用场景**：需要异步 publish、批量 drain 或测试出站顺序的传输插件；不负责持久化。
 *
 * **关键导出**：`OutboundMessageQueue`、`OutboundQueueItem`
 */

import type { UnifiedMessage } from "../core/types.js";

/**
 * 出站队列条目。
 *
 * @property sessionKey - OpenClaw 会话 key，用于按会话分组
 * @property message - 原始 UnifiedMessage
 * @property text - 已解析出的可投递文本
 * @property pushedAt - 入队时间戳（毫秒）
 */
export interface OutboundQueueItem {
  sessionKey: string;
  message: UnifiedMessage;
  text: string;
  pushedAt: number;
}

export interface OutboundMessageQueueOptions {
  /** 全部 session 合计的最大条目数；默认 10000。 */
  maxSize?: number;
  /** 队列满时的可观测性回调。 */
  onOverflow?: (item: Omit<OutboundQueueItem, "pushedAt">) => void;
}

/**
 * 按 sessionKey 分组的 FIFO 出站队列。
 *
 * 不传 sessionKey 调用 `pop` 时会从 Map 迭代顺序中第一个非空 session 取一条，
 * 适合简单 drain；需要严格跨 session 公平性时应在调用方自行调度。
 *
 * @example
 * ```ts
 * const queue = new OutboundMessageQueue();
 * queue.push({ sessionKey: "wecom:acc1:user1", message, text: "hello" });
 * const item = queue.pop("wecom:acc1:user1");
 * ```
 */
export class OutboundMessageQueue {
  private readonly bySession = new Map<string, OutboundQueueItem[]>();
  private readonly maxSize: number;
  private readonly onOverflow?: OutboundMessageQueueOptions["onOverflow"];
  private totalSize = 0;

  constructor(options: OutboundMessageQueueOptions = {}) {
    const maxSize = options.maxSize ?? 10_000;
    if (!Number.isSafeInteger(maxSize) || maxSize < 1) {
      throw new Error("OutboundMessageQueue maxSize must be a positive safe integer");
    }
    this.maxSize = maxSize;
    this.onOverflow = options.onOverflow;
  }

  /**
   * 向指定 session 的尾部追加一条出站消息。
   *
   * @param item - 除 pushedAt 外的队列条目字段
   */
  push(item: Omit<OutboundQueueItem, "pushedAt">): boolean {
    if (this.totalSize >= this.maxSize) {
      this.onOverflow?.(item);
      return false;
    }
    const list = this.bySession.get(item.sessionKey) ?? [];
    list.push({ ...item, pushedAt: Date.now() });
    this.bySession.set(item.sessionKey, list);
    this.totalSize += 1;
    return true;
  }

  /**
   * 取出一条出站消息。
   *
   * @param sessionKey - 指定时只从该 session 取；不指定时从任意非空 session 取
   * @returns 出站条目；队列为空时返回 `undefined`
   */
  pop(sessionKey?: string): OutboundQueueItem | undefined {
    if (sessionKey) {
      const list = this.bySession.get(sessionKey);
      if (!list?.length) return undefined;
      const item = list.shift();
      if (item) this.totalSize -= 1;
      if (list.length === 0) this.bySession.delete(sessionKey);
      return item;
    }
    for (const [key, list] of this.bySession) {
      if (list.length > 0) {
        const item = list.shift();
        if (item) this.totalSize -= 1;
        if (list.length === 0) this.bySession.delete(key);
        return item;
      }
    }
    return undefined;
  }

  /**
   * 查看指定 session 的下一条出站消息但不移除。
   *
   * @param sessionKey - 要查看的 session key
   * @returns 队首条目；该 session 无消息时返回 `undefined`
   */
  peek(sessionKey: string): OutboundQueueItem | undefined {
    return this.bySession.get(sessionKey)?.[0];
  }

  /** 全部 session 合计的待发送条目数。 */
  get size(): number {
    return this.totalSize;
  }

  /**
   * 清空队列。
   *
   * @param sessionKey - 指定时仅清空该 session；不指定时清空全部 session
   */
  clear(sessionKey?: string): void {
    if (sessionKey) {
      this.totalSize -= this.bySession.get(sessionKey)?.length ?? 0;
      this.bySession.delete(sessionKey);
      return;
    }
    this.bySession.clear();
    this.totalSize = 0;
  }
}
