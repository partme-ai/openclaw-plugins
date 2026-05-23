/**
 * Runs tasks serially per key while allowing different keys to run in parallel.
 *
 * 典型用途是同一个会话内的多条消息要串行处理，但不同会话可以并发处理。
 * 这避免了同一 peer 的回复顺序错乱，同时不会牺牲全局吞吐。
 */

/**
 * 按 key 串行执行的任务函数。
 *
 * @param ctx.key - 归一化后的队列 key，空字符串会被归一化为 `default`。
 * @param ctx.lifecycleSignal - 生命周期取消信号，通常来自插件 shutdown 或请求超时。
 */
export type KeyedRunQueueTask<T> = (ctx: {
  key: string;
  lifecycleSignal?: AbortSignal;
}) => Promise<T>;

/**
 * keyed run queue 配置。
 *
 * @property abortSignal - 全局取消信号；触发后不再接受新任务。
 * @property onError - 任务失败回调，用于审计或记录对应 key 的异常。
 */
export type KeyedRunQueueOptions = {
  abortSignal?: AbortSignal;
  onError?: (error: unknown, key: string) => void | Promise<void>;
};

/**
 * 按 key 串行、跨 key 并行的运行队列。
 *
 * @property enqueue - 把任务加入指定 key 的尾部。
 * @property deactivate - 关闭队列，后续 enqueue 会被拒绝。
 * @property pendingKeys - 返回仍有任务链的 key。
 * @property size - 返回当前仍有任务链的 key 数量。
 */
export type KeyedRunQueue = {
  enqueue: <T>(key: string, task: KeyedRunQueueTask<T>) => Promise<T>;
  deactivate: () => void;
  pendingKeys: () => string[];
  size: () => number;
};

/**
 * 队列停用后继续 enqueue 时抛出的错误。
 *
 * 通过独立错误类型，调用方可以把“生命周期关闭”与业务任务失败区分开。
 */
export class KeyedRunQueueInactiveError extends Error {
  constructor() {
    super("KeyedRunQueue is inactive");
    this.name = "KeyedRunQueueInactiveError";
  }
}

function normalizeQueueKey(key: string): string {
  return key?.trim() || "default";
}

function abortError(): Error {
  const err = new Error("KeyedRunQueue aborted");
  err.name = "AbortError";
  return err;
}

/**
 * 创建按 key 串行执行的运行队列。
 *
 * @param options - 全局取消信号与错误回调。
 * @returns 一个轻量内存队列；同一 key 的任务按提交顺序执行，不同 key 可并行。
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
     * 返回当前仍有任务链的 key。
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
