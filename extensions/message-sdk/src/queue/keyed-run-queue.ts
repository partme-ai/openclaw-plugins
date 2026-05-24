/**
 * @module queue/keyed-run-queue
 *
 * 按 key 串行、跨 key 并行的轻量内存任务队列。
 *
 * **职责**：同一 key（如 accountId:chatId）内的任务严格 FIFO 串行执行，
 * 不同 key 之间互不阻塞，避免同一会话回复顺序错乱同时保持全局吞吐。
 *
 * **适用场景**：WeCom `chat-queue`、Feishu 等同会话串行 Agent 运行。
 *
 * **关键导出**：`createKeyedRunQueue`、`KeyedRunQueue`、`KeyedRunQueueInactiveError`
 */

/**
 * 按 key 串行执行的任务函数。
 *
 * @param ctx.key - 归一化后的队列 key，空字符串会被归一化为 `default`
 * @param ctx.lifecycleSignal - 生命周期取消信号，通常来自插件 shutdown 或请求超时
 */
export type KeyedRunQueueTask<T> = (ctx: {
  key: string;
  lifecycleSignal?: AbortSignal;
}) => Promise<T>;

/**
 * keyed run queue 配置。
 *
 * @property abortSignal - 全局取消信号；触发后不再接受新任务
 * @property onError - 任务失败回调，用于审计或记录对应 key 的异常
 */
export type KeyedRunQueueOptions = {
  abortSignal?: AbortSignal;
  onError?: (error: unknown, key: string) => void | Promise<void>;
};

/**
 * 按 key 串行、跨 key 并行的运行队列实例。
 *
 * @property enqueue - 把任务加入指定 key 的尾部
 * @property deactivate - 关闭队列，后续 enqueue 会被拒绝
 * @property pendingKeys - 返回仍有任务链的 key
 * @property size - 返回当前仍有任务链的 key 数量
 */
export type KeyedRunQueue = {
  enqueue: <T>(key: string, task: KeyedRunQueueTask<T>) => Promise<T>;
  deactivate: () => void;
  /** O(1) check whether a key has a pending or running task chain. */
  has: (key: string) => boolean;
  pendingKeys: () => string[];
  size: () => number;
};

/**
 * 队列停用后继续 enqueue 时抛出的错误。
 *
 * 通过独立错误类型，调用方可以把「生命周期关闭」与业务任务失败区分开。
 */
export class KeyedRunQueueInactiveError extends Error {
  constructor() {
    super("KeyedRunQueue is inactive");
    this.name = "KeyedRunQueueInactiveError";
  }
}

/** 将空 key 归一化为 `default`，避免 Map 中出现多种「空 key」表示。 */
function normalizeQueueKey(key: string): string {
  return key?.trim() || "default";
}

/** 构造与 AbortSignal 兼容的取消错误。 */
function abortError(): Error {
  const err = new Error("KeyedRunQueue aborted");
  err.name = "AbortError";
  return err;
}

/**
 * 创建按 key 串行执行的运行队列。
 *
 * 内部用 `tails` Map 维护每个 key 的 Promise 链：新任务 `.then` 挂在前一个 tail 之后，
 * 无论前一个成功或失败都会继续执行后续任务，避免某个 key 因单次失败永久卡死。
 *
 * @param options - 全局取消信号与错误回调
 * @returns 轻量内存队列；同一 key 的任务按提交顺序执行，不同 key 可并行
 *
 * @example
 * ```ts
 * const queue = createKeyedRunQueue();
 * await queue.enqueue("acc1:chat1", async () => { /* 处理消息 A *\/ });
 * await queue.enqueue("acc1:chat1", async () => { /* 处理消息 B（在 A 之后） *\/ });
 * await queue.enqueue("acc1:chat2", async () => { /* 与会话 1 并行 *\/ });
 * ```
 */
export function createKeyedRunQueue(options: KeyedRunQueueOptions = {}): KeyedRunQueue {
  const tails = new Map<string, Promise<unknown>>();
  let active = true;

  if (options.abortSignal) {
    options.abortSignal.addEventListener(
      "abort",
      () => {
        active = false;
      },
      { once: true },
    );
  }

  async function runTask<T>(
    key: string,
    task: KeyedRunQueueTask<T>,
    lifecycleSignal?: AbortSignal,
  ): Promise<T> {
    if (!active) throw new KeyedRunQueueInactiveError();
    if (options.abortSignal?.aborted || lifecycleSignal?.aborted) throw abortError();
    try {
      return await task({ key, lifecycleSignal: lifecycleSignal ?? options.abortSignal });
    } catch (err) {
      await options.onError?.(err, key);
      throw err;
    }
  }

  return {
    /**
     * 将任务追加到指定 key 的尾部。
     *
     * 即使前一个任务失败，后续任务仍会继续执行；失败会通过返回的 Promise 和
     * `onError` 同时暴露，避免某个 key 永久卡死。
     *
     * @param rawKey - 队列 key（如 `accountId:chatId`）
     * @param task - 异步任务函数
     * @returns 该次任务的完成 Promise
     */
    enqueue<T>(rawKey: string, task: KeyedRunQueueTask<T>): Promise<T> {
      const key = normalizeQueueKey(rawKey);
      if (!active) return Promise.reject(new KeyedRunQueueInactiveError());

      const previous = tails.get(key) ?? Promise.resolve();
      // 将成功和失败分支都接到 runTask，确保上一项失败不会阻断该 key 的后续任务。
      const next = previous.then(
        () => runTask(key, task, options.abortSignal),
        () => runTask(key, task, options.abortSignal),
      );
      tails.set(key, next);
      // 任务完成后只清理当前 tail，避免并发 enqueue 时误删更新后的任务链。
      void next
        .finally(() => {
          if (tails.get(key) === next) tails.delete(key);
        })
        .catch(() => undefined);
      return next;
    },

    /**
     * 停用队列，拒绝后续新任务。
     */
    deactivate() {
      active = false;
    },

    /**
     * 判断指定 key 是否仍有待处理或执行中的任务链。
     *
     * @param rawKey - 队列 key（如 `accountId:chatId`）
     * @returns 该 key 是否在队列中
     */
    has(rawKey: string) {
      return tails.has(normalizeQueueKey(rawKey));
    },

    /**
     * 返回当前仍有任务链的 key。
     *
     * @returns 待处理或执行中的 key 列表
     */
    pendingKeys() {
      return [...tails.keys()];
    },

    /**
     * 返回当前仍有任务链的 key 数量。
     */
    size() {
      return tails.size;
    },
  };
}
