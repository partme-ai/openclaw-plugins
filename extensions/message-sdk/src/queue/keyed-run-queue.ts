/**
 * @module queue/keyed-run-queue
 *
 * 按 key 串行、跨 key 并行的有界内存任务队列。
 *
 * **职责**：同一 key（如 accountId:chatId）内的任务严格 FIFO 串行执行，
 * 不同 key 之间互不阻塞，避免同一会话回复顺序错乱同时保持全局吞吐。
 *
 * **重要语义**：调用方看到「超时」只表示等待预算耗尽，不等于底层异步任务已经停止。
 * 队列会向任务发送 AbortSignal，但仍会等待该任务真实 settle 后才启动同 key 的下一项，
 * 防止忽略取消信号的副作用与后续消息重叠执行。
 *
 * **适用场景**：WeCom、MQTT 等同会话串行 Agent 运行或入站消息处理。
 *
 * **关键导出**：`createKeyedRunQueue`、`KeyedRunQueue`、容量与生命周期错误类型。
 */

import { AsyncTimeoutError } from "../util/async-timeout.js";

/** 按 key 串行执行的任务函数。 */
export type KeyedRunQueueTask<T> = (ctx: {
  /** 归一化后的队列 key，空字符串会变成 `default`。 */
  key: string;
  /** 插件停用、外部取消或任务超时时触发；任务应主动监听并尽快退出。 */
  lifecycleSignal?: AbortSignal;
}) => Promise<T>;

/** 队列容量耗尽的原因。 */
export type KeyedRunQueueCapacityReason = "tasks" | "keys";

/** keyed run queue 配置。 */
export type KeyedRunQueueOptions = {
  /** 外部生命周期取消信号；触发后停止接收新任务并取消正在运行的任务。 */
  abortSignal?: AbortSignal;
  /** 任务失败、取消或超时时的观测回调；回调自身失败不会覆盖原始错误。 */
  onError?: (error: unknown, key: string) => void | Promise<void>;
  /** 同 key 排队超过该毫秒数时触发 onWaitWarn。 */
  waitWarnMs?: number;
  /** 排队过久回调；回调自身失败会被隔离。 */
  onWaitWarn?: (info: { key: string; waitMs: number; depth: number }) => void | Promise<void>;
  /** 单任务等待预算；超时后通知取消，但同 key 队列仍等待底层任务真实结束。 */
  taskTimeoutMs?: number;
  /** 运行中与排队中的任务总上限；默认 10000。 */
  maxPendingTasks?: number;
  /** 同时存在任务链的 key 数量上限；默认 1000。 */
  maxKeys?: number;
  /** 容量溢出观测回调；回调自身失败会被隔离。 */
  onOverflow?: (info: {
    key: string;
    pendingTasks: number;
    pendingKeys: number;
    reason: KeyedRunQueueCapacityReason;
  }) => void | Promise<void>;
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

/** 按 key 串行、跨 key 并行的运行队列实例。 */
export type KeyedRunQueue = {
  enqueue: <T>(key: string, task: KeyedRunQueueTask<T>) => Promise<T>;
  /** 停止接收新任务，并向运行中的任务广播取消信号。 */
  deactivate: () => void;
  /** 等待停用时已经存在的任务链真实结束；调用方应先执行 deactivate()。 */
  drain: () => Promise<void>;
  /** O(1) 判断 key 是否存在运行中或排队中的任务链。 */
  has: (key: string) => boolean;
  pendingKeys: () => string[];
  size: () => number;
  snapshot: () => KeyedRunQueueSnapshot;
};

/** 队列停用后继续 enqueue 时抛出的错误。 */
export class KeyedRunQueueInactiveError extends Error {
  constructor() {
    super("KeyedRunQueue is inactive");
    this.name = "KeyedRunQueueInactiveError";
  }
}

/** 队列达到任务数或 key 数容量上限时抛出的错误。 */
export class KeyedRunQueueCapacityError extends Error {
  constructor(
    public readonly reason: KeyedRunQueueCapacityReason,
    public readonly limit: number,
  ) {
    super(`KeyedRunQueue ${reason} capacity exceeded (limit=${limit})`);
    this.name = "KeyedRunQueueCapacityError";
  }
}

/** 将空 key 归一化为 `default`，避免 Map 中出现多种「空 key」表示。 */
function normalizeQueueKey(key: string): string {
  return key?.trim() || "default";
}

/** 构造与 AbortSignal 兼容的取消错误。 */
function abortError(): Error {
  const error = new Error("KeyedRunQueue aborted");
  error.name = "AbortError";
  return error;
}

/** 校验容量配置，避免 NaN、小数或超大数字绕过内存边界。 */
function positiveSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`KeyedRunQueue ${name} must be a positive safe integer`);
  }
  return value;
}

/** 观测回调不属于任务主链：隔离同步异常与 Promise rejection，避免反向击穿队列。 */
function safelyNotify(callback: (() => void | Promise<void>) | undefined): void {
  if (!callback) return;
  try {
    void Promise.resolve(callback()).catch(() => undefined);
  } catch {
    // 可观测性回调失败不能改变消息处理结果。
  }
}

/** 创建按 key 串行执行的运行队列。 */
export function createKeyedRunQueue(options: KeyedRunQueueOptions = {}): KeyedRunQueue {
  const maxPendingTasks = positiveSafeInteger(options.maxPendingTasks ?? 10_000, "maxPendingTasks");
  const maxKeys = positiveSafeInteger(options.maxKeys ?? 1_000, "maxKeys");
  const tails = new Map<string, Promise<void>>();
  const keyDepth = new Map<string, number>();
  const keyWaitSince = new Map<string, number>();
  const waitWarnTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const lifecycleController = new AbortController();
  let pendingTasks = 0;
  let active = true;

  function clearWaitWarnTimer(key: string): void {
    const timer = waitWarnTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      waitWarnTimers.delete(key);
    }
  }

  /** 停用不仅拒绝新任务，还向已启动任务发出协作式取消通知。 */
  function deactivate(): void {
    if (!active) return;
    active = false;
    lifecycleController.abort();
    for (const key of waitWarnTimers.keys()) clearWaitWarnTimer(key);
  }

  if (options.abortSignal) {
    if (options.abortSignal.aborted) deactivate();
    else options.abortSignal.addEventListener("abort", deactivate, { once: true });
  }

  function scheduleWaitWarn(key: string, depth: number): void {
    const waitWarnMs = options.waitWarnMs;
    if (!waitWarnMs || waitWarnMs <= 0 || !options.onWaitWarn || depth <= 1) return;
    if (waitWarnTimers.has(key)) return;

    const waitSince = keyWaitSince.get(key) ?? Date.now();
    const delay = Math.max(0, waitWarnMs - (Date.now() - waitSince));
    const timer = setTimeout(() => {
      waitWarnTimers.delete(key);
      const currentDepth = keyDepth.get(key) ?? 0;
      if (currentDepth <= 1) return;
      const waitMs = Date.now() - (keyWaitSince.get(key) ?? waitSince);
      safelyNotify(() => options.onWaitWarn?.({ key, waitMs, depth: currentDepth }));
    }, delay);
    waitWarnTimers.set(key, timer);
  }

  function decrementKeyDepth(key: string): void {
    pendingTasks -= 1;
    const depth = (keyDepth.get(key) ?? 1) - 1;
    if (depth <= 0) {
      keyDepth.delete(key);
      keyWaitSince.delete(key);
      clearWaitWarnTimer(key);
      return;
    }
    keyDepth.set(key, depth);
    scheduleWaitWarn(key, depth);
  }

  function buildSnapshot(): KeyedRunQueueSnapshot {
    const pendingKeys = [...keyDepth.keys()];
    let queuedCount = 0;
    const keys: Record<string, KeyedRunQueueKeyState> = {};

    for (const key of pendingKeys) {
      const depth = keyDepth.get(key) ?? 0;
      const oldestWaitMs = keyWaitSince.has(key)
        ? Date.now() - (keyWaitSince.get(key) ?? Date.now())
        : undefined;
      if (depth > 1) queuedCount += depth - 1;
      keys[key] = { depth, ...(oldestWaitMs !== undefined ? { oldestWaitMs } : {}) };
    }
    return { queuedCount, activeCount: pendingKeys.length, pendingKeys, keys };
  }

  return {
    enqueue<T>(rawKey: string, task: KeyedRunQueueTask<T>): Promise<T> {
      const key = normalizeQueueKey(rawKey);
      if (!active) return Promise.reject(new KeyedRunQueueInactiveError());

      const capacityReason: KeyedRunQueueCapacityReason | undefined =
        pendingTasks >= maxPendingTasks ? "tasks" : !tails.has(key) && tails.size >= maxKeys ? "keys" : undefined;
      if (capacityReason) {
        safelyNotify(() =>
          options.onOverflow?.({ key, pendingTasks, pendingKeys: tails.size, reason: capacityReason }),
        );
        return Promise.reject(
          new KeyedRunQueueCapacityError(
            capacityReason,
            capacityReason === "tasks" ? maxPendingTasks : maxKeys,
          ),
        );
      }

      const previous = tails.get(key) ?? Promise.resolve();
      const previousDepth = keyDepth.get(key) ?? 0;
      keyDepth.set(key, previousDepth + 1);
      pendingTasks += 1;
      if (previousDepth > 0) {
        if (!keyWaitSince.has(key)) keyWaitSince.set(key, Date.now());
        scheduleWaitWarn(key, previousDepth + 1);
      }

      let resolveCaller!: (value: T) => void;
      let rejectCaller!: (reason: unknown) => void;
      const callerResult = new Promise<T>((resolve, reject) => {
        resolveCaller = resolve;
        rejectCaller = reject;
      });

      const tail = previous.then(async () => {
        /** 先释放容量再通知调用方，保证 `await enqueue()` 返回后快照与容量已经一致。 */
        const release = (): void => {
          decrementKeyDepth(key);
          if (tails.get(key) === tail) tails.delete(key);
        };

        if (!active || lifecycleController.signal.aborted) {
          release();
          rejectCaller(abortError());
          return;
        }

        const taskController = new AbortController();
        const lifecycleSignal = AbortSignal.any([lifecycleController.signal, taskController.signal]);
        let callerSettled = false;
        let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
        let abortListener: (() => void) | undefined;

        /** 调用方只收到一次结果，错误观测也只上报一次。 */
        const rejectOnce = (error: unknown): void => {
          if (callerSettled) return;
          callerSettled = true;
          rejectCaller(error);
          safelyNotify(() => options.onError?.(error, key));
        };

        abortListener = () => rejectOnce(abortError());
        lifecycleController.signal.addEventListener("abort", abortListener, { once: true });

        let taskPromise: Promise<T>;
        try {
          taskPromise = task({ key, lifecycleSignal });
        } catch (error) {
          taskPromise = Promise.reject(error);
        }
        const timeoutMs = options.taskTimeoutMs;
        if (timeoutMs && timeoutMs > 0 && Number.isFinite(timeoutMs)) {
          timeoutTimer = setTimeout(() => {
            const error = new AsyncTimeoutError(
              `KeyedRunQueue task timed out after ${timeoutMs}ms (key=${key})`,
            );
            taskController.abort(error);
            rejectOnce(error);
          }, timeoutMs);
        }

        let value: T | undefined;
        let taskError: unknown;
        try {
          value = await taskPromise;
        } catch (error) {
          taskError = error;
        } finally {
          if (timeoutTimer) clearTimeout(timeoutTimer);
          if (abortListener) lifecycleController.signal.removeEventListener("abort", abortListener);
          // 超时任务即使忽略 AbortSignal，也必须在这里真实结束后才释放同 key 的执行权。
          release();
        }

        if (!callerSettled) {
          if (taskError !== undefined) {
            rejectOnce(taskError);
          } else {
            callerSettled = true;
            resolveCaller(value as T);
          }
        }
      });

      tails.set(key, tail);
      return callerResult;
    },

    deactivate,

    async drain() {
      // 复制当前 tail：deactivate 后不会再接收新任务，因此快照覆盖全部待收敛工作。
      await Promise.allSettled([...tails.values()]);
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
