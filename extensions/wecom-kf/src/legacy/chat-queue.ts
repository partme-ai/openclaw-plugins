/**
 * Legacy Bot/Agent 同会话串行队列（message-sdk `createKeyedRunQueue` 薄封装）。
 *
 * 仅在 `legacyWecomCsEnabled` 路径使用，避免同 chat 并发 dispatch 导致 stream 状态竞态。
 */

import { createKeyedRunQueue, type KeyedRunQueue } from "@partme.ai/openclaw-message-sdk/queue";

type QueueStatus = "queued" | "immediate";

let chatQueue: KeyedRunQueue = createKeyedRunQueue();

/**
 * 构建队列键（accountId + chatId 维度）。
 */
export function buildLegacyChatQueueKey(accountId: string, chatId: string): string {
  return `${accountId}:${chatId}`;
}

/**
 * 检查指定队列键是否有正在处理或排队的任务。
 */
export function hasLegacyChatTask(key: string): boolean {
  return chatQueue.pendingKeys().includes(key);
}

/**
 * 将 Legacy 入站处理任务加入串行队列。
 */
export function enqueueLegacyChatTask(params: {
  accountId: string;
  chatId: string;
  task: () => Promise<void>;
}): { status: QueueStatus; promise: Promise<void> } {
  const { accountId, chatId, task } = params;
  const key = buildLegacyChatQueueKey(accountId, chatId);
  const status: QueueStatus = chatQueue.pendingKeys().includes(key) ? "queued" : "immediate";
  const promise = chatQueue.enqueue(key, async () => {
    await task();
  });
  return { status, promise };
}

/** @internal 测试专用：重置队列状态 */
export function _resetLegacyChatQueueState(): void {
  chatQueue.deactivate();
  chatQueue = createKeyedRunQueue();
}
