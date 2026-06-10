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

import { withTimeout } from "../util/async-timeout.js";

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
 * @property waitWarnMs - 同 key 排队超过该毫秒数时触发 onWaitWarn
 * @property onWaitWarn - 排队过久回调（key 已归一化）
 * @property taskTimeoutMs - 单任务硬超时（毫秒），0 或未设置表示不限制
 */
export type KeyedRunQueueOptions = {
  abortSignal?: AbortSignal;
  onError?: (error: unknown, key: string) => void | Promise<void>;
  waitWarnMs?: number;
  onWaitWarn?: (info: { key: string; waitMs: number; depth: number }) => void | Promise<void>;
  taskTimeoutMs?: number;
};

/** 单个 key 的队列快照。 */
export type KeyedRunQueueKeyState = {
  depth: number;
  oldestWaitMs?: number;
};

/** 队列全局快照（可观测性）。 */
export type KeyedRunQueueSnapshot = {
  queuedCount: number;
  activeCount: number;
  pendingKeys: string[];
  keys: Record<string, KeyedRunQueueKeyState>;
};

/**
 * 按 key 串行、跨 key 并行的运行队列实例。
 */
export type KeyedRunQueue = {
  enqueue: <T>(key: string, task: KeyedRunQueueTask<T>) => Promise<T>;
  deactivate: () => void;
  /** O(1) check whether a key has a pending or running task chain. */
  has: (key: string) => boolean;
  pendingKeys: () => string[];
  size: () => number;
  snapshot: () => KeyedRunQueueSnapshot;
};

/**
 * 队列停用后继续 enqueue 时抛出的错误。
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
 */
export function createKeyedRunQueue(options: KeyedRunQueueOptions = {}): KeyedRunQueue {
  const tails = new Map<string, Promise<unknown>>();
  const keyDepth = new Map<string, number>();
  const keyWaitSince = new Map<string, number>();
  const waitWarnTimers = new Map<string, ReturnType<typeof setTimeout>>();
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

  function clearWaitWarnTimer(key: string): void {
    const timer = waitWarnTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      waitWarnTimers.delete(key);
    }
  }

  function scheduleWaitWarn(key: string, depth: number): void {
    const waitWarnMs = options.waitWarnMs;
    if (!waitWarnMs || waitWarnMs <= 0 || !options.onWaitWarn || depth <= 1) {
      return;
    }
    if (waitWarnTimers.has(key)) return;

    const waitSince = keyWaitSince.get(key) ?? Date.now();
    const elapsed = Date.now() - waitSince;
    const delay = Math.max(0, waitWarnMs - elapsed);

    const timer = setTimeout(() => {
      waitWarnTimers.delete(key);
      const currentDepth = keyDepth.get(key) ?? 0;
      if (currentDepth <= 1) return;
      const waitMs = Date.now() - (keyWaitSince.get(key) ?? waitSince);
      void options.onWaitWarn?.({ key, waitMs, depth: currentDepth });
    }, delay);
    waitWarnTimers.set(key, timer);
  }

  function decrementKeyDepth(key: string): void {
    const depth = (keyDepth.get(key) ?? 1) - 1;
    if (depth <= 0) {
      keyDepth.delete(key);
      keyWaitSince.delete(key);
      clearWaitWarnTimer(key);
    } else {
      keyDepth.set(key, depth);
      scheduleWaitWarn(key, depth);
    }
  }

  async function runTask<T>(
    key: string,
    task: KeyedRunQueueTask<T>,
    lifecycleSignal?: AbortSignal,
  ): Promise<T> {
    if (!active) throw new KeyedRunQueueInactiveError();
    if (options.abortSignal?.aborted || lifecycleSignal?.aborted) throw abortError();

    const execute = () => task({ key, lifecycleSignal: lifecycleSignal ?? options.abortSignal });
    const taskTimeoutMs = options.taskTimeoutMs;
    try {
      if (taskTimeoutMs && taskTimeoutMs > 0) {
        return await withTimeout(
          execute(),
          taskTimeoutMs,
          `KeyedRunQueue task timed out after ${taskTimeoutMs}ms (key=${key})`,
        );
      }
      return await execute();
    } catch (err) {
      await options.onError?.(err, key);
      throw err;
    }
  }

  function buildSnapshot(): KeyedRunQueueSnapshot {
    const pendingKeys = [...keyDepth.keys()];
    let queuedCount = 0;
    const keys: Record<string, KeyedRunQueueKeyState> = {};

    for (const key of pendingKeys) {
      const depth = keyDepth.get(key) ?? 0;
      const oldestWaitMs = keyWaitSince.has(key) ? Date.now() - (keyWaitSince.get(key) ?? Date.now()) : undefined;
      if (depth > 1) queuedCount += depth - 1;
      keys[key] = { depth, ...(oldestWaitMs !== undefined ? { oldestWaitMs } : {}) };
    }

    return {
      queuedCount,
      activeCount: pendingKeys.length,
      pendingKeys,
      keys,
    };
  }

  return {
    enqueue<T>(rawKey: string, task: KeyedRunQueueTask<T>): Promise<T> {
      const key = normalizeQueueKey(rawKey);
      if (!active) return Promise.reject(new KeyedRunQueueInactiveError());

      const prevDepth = keyDepth.get(key) ?? 0;
      keyDepth.set(key, prevDepth + 1);
      if (prevDepth > 0) {
        if (!keyWaitSince.has(key)) keyWaitSince.set(key, Date.now());
        scheduleWaitWarn(key, prevDepth + 1);
      }

      const previous = tails.get(key) ?? Promise.resolve();
      const next = previous.then(
        () => runTask(key, task, options.abortSignal),
        () => runTask(key, task, options.abortSignal),
      );
      tails.set(key, next);
      void next
        .finally(() => {
          decrementKeyDepth(key);
          if (tails.get(key) === next) tails.delete(key);
        })
        .catch(() => undefined);
      return next;
    },

    deactivate() {
      active = false;
      for (const key of waitWarnTimers.keys()) clearWaitWarnTimer(key);
    },

    has(rawKey: string) {
      return tails.has(normalizeQueueKey(rawKey));
    },

    pendingKeys() {
      return [...tails.keys()];
    },

    size() {
      return tails.size;
    },

    snapshot() {
      return buildSnapshot();
    },
  };
}
