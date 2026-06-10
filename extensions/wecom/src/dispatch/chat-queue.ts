/**
 * @module chat-queue
 *
 * 同会话串行任务队列（WeCom 薄封装 message-sdk `createKeyedRunQueue`）。
 *
 * **职责**：按 `accountId:chatId` 维度串行执行入站消息处理，避免同一会话并发 dispatch
 * 导致流式 streamId / session 状态竞态；后续消息排队等待前一条完成。
 *
 * **适用场景**：`monitor` 在 `prepareWeComMessage` 成功后入队 `processWeComMessageNow`。
 *
 * **上下游**：
 * - 上游：`@partme.ai/openclaw-message-sdk/queue`
 * - 下游：monitor 消息处理协程
 *
 * **关键导出**：`enqueueWeComChatTask`、`buildQueueKey`、`hasActiveTask`、`getWeComChatQueueSnapshot`
 */

import {
  createKeyedRunQueue,
  type KeyedRunQueue,
  type KeyedRunQueueSnapshot,
} from "@partme.ai/openclaw-message-sdk/queue";

/** 入队结果：立即执行或排队等待 */
type QueueStatus = "queued" | "immediate";

/** 同 key 排队过久告警阈值（毫秒）。 */
const CHAT_QUEUE_WAIT_WARN_MS = 30_000;

/** 进程级单例队列 */
let chatQueue: KeyedRunQueue = createWeComChatQueue();

/**
 * 创建带可观测性回调的 WeCom chat 队列实例。
 */
function createWeComChatQueue(): KeyedRunQueue {
  return createKeyedRunQueue({
    waitWarnMs: CHAT_QUEUE_WAIT_WARN_MS,
    onWaitWarn: ({ key, waitMs, depth }) => {
      console.warn(
        `[wecom-queue] chat wait high key=${compactQueueKey(key)} waitMs=${waitMs} depth=${depth}`,
      );
    },
  });
}

/**
 * 压缩队列 key 用于日志（account/chat 部分脱敏）。
 */
function compactQueueKey(key: string): string {
  const sep = key.indexOf(":");
  if (sep <= 0) return key.slice(0, 8);
  const account = key.slice(0, sep);
  const chat = key.slice(sep + 1);
  const accountCompact = account.length <= 6 ? account : `${account.slice(0, 4)}…`;
  const chatCompact = chat.length <= 8 ? chat : `…${chat.slice(-6)}`;
  return `${accountCompact}:${chatCompact}`;
}

/**
 * 构建队列键（accountId + chatId 维度）。
 *
 * @param accountId - 企微账号 ID
 * @param chatId - 会话 ID（群 chatid 或用户 userid）
 * @returns 队列键，格式 `{accountId}:{chatId}`
 */
export function buildQueueKey(accountId: string, chatId: string): string {
  return `${accountId}:${chatId}`;
}

/**
 * 检查指定队列键是否有正在处理或排队的任务。
 *
 * @param key - `buildQueueKey` 返回值
 * @returns 是否有活跃任务
 */
export function hasActiveTask(key: string): boolean {
  return chatQueue.has(key);
}

/**
 * 返回当前 chat 队列快照（可观测性）。
 */
export function getWeComChatQueueSnapshot(): KeyedRunQueueSnapshot {
  return chatQueue.snapshot();
}

/**
 * 将任务加入串行队列。
 *
 * **串行保证**：同一 key 下任务严格 FIFO；不同 key 可并行。
 *
 * @param params.accountId - 账号 ID
 * @param params.chatId - 会话 ID
 * @param params.task - 异步处理函数（通常为 `processWeComMessageNow`）
 * @returns `status` 表示立即执行或排队；`promise` 为任务完成 Promise
 */
export function enqueueWeComChatTask(params: {
  accountId: string;
  chatId: string;
  task: () => Promise<void>;
}): { status: QueueStatus; promise: Promise<void> } {
  const { accountId, chatId, task } = params;
  const key = buildQueueKey(accountId, chatId);
  const status: QueueStatus = chatQueue.has(key) ? "queued" : "immediate";
  const snap = chatQueue.snapshot();
  const keyState = snap.keys[key];

  if (status === "queued") {
    console.log(
      `[wecom-queue] enqueue queued key=${compactQueueKey(key)} depth=${keyState?.depth ?? "?"} queued=${snap.queuedCount}`,
    );
  }

  const promise = chatQueue.enqueue(key, async () => {
    const startedAt = Date.now();
    await task();
    const elapsed = Date.now() - startedAt;
    if (elapsed > 1_000) {
      console.log(`[wecom-queue] task done key=${compactQueueKey(key)} elapsedMs=${elapsed}`);
    }
  });
  return { status, promise };
}

/** @internal 测试专用：重置所有队列状态 */
export function _resetChatQueueState(): void {
  chatQueue.deactivate();
  chatQueue = createWeComChatQueue();
}

/** @internal 测试专用：读取 wait warn 阈值 */
export function _chatQueueWaitWarnMsForTest(): number {
  return CHAT_QUEUE_WAIT_WARN_MS;
}
