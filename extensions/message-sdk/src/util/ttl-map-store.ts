/**
 * @module util/ttl-map-store
 *
 * 带 TTL 与容量上限的内存 Map 存储 / In-memory Map store with TTL and size cap.
 *
 * **职责**：提供通用 TTL Map 及 chatId → reqId 专用存储，支持过期清理、
 * LRU 式容量淘汰与可选定时 prune。
 *
 * **适用场景**：MessageState、ReqId 关联、短期会话元数据缓存。
 *
 * **上下游**：
 * - 上游：ingress / wecom / feishu 等通道插件
 * - 下游：无持久化，纯进程内存
 *
 * **关键导出**：`createTtlMapStore`、`createReqIdStore`、`TtlMapStore`、`ReqIdStore`
 */

/** TTL Map 配置 / Options for {@link createTtlMapStore} */
export interface TtlMapStoreOptions {
  /** TTL 毫秒数；0 表示永不过期 / TTL in ms; 0 = no expiry */
  ttlMs?: number;
  /** 最大条目数 / Maximum entry count before LRU eviction */
  maxSize?: number;
  /** 定期清理间隔（毫秒）；未设置则不启动定时器 / Periodic prune interval */
  cleanupIntervalMs?: number;
}

interface TtlEntry<T> {
  value: T;
  createdAt: number;
}

/** TTL Map 公开接口 / Public TTL map API */
export interface TtlMapStore<T> {
  /** 写入或更新键值（刷新 createdAt）/ Set or refresh entry */
  set(key: string, value: T): void;
  /** 读取；过期条目自动删除并返回 undefined / Get; expired entries removed */
  get(key: string): T | undefined;
  /** 删除指定键 / Delete by key */
  delete(key: string): void;
  /** 清空全部条目 / Clear all entries */
  clear(): void;
  /** 当前条目数 / Current size */
  size(): number;
  /** 启动定时 prune（需配置 cleanupIntervalMs）/ Start interval cleanup */
  startCleanup(): void;
  /** 停止定时 prune / Stop interval cleanup */
  stopCleanup(): void;
}

/**
 * 创建带 TTL 与容量控制的内存 Map。
 *
 * 写入时触发 prune：先删过期项，再按 createdAt 淘汰最旧条目直至 `maxSize`。
 *
 * @param options - TTL、容量与清理间隔 / Store options
 * @returns TTL Map 实例 / Configured store
 *
 * @example
 * ```ts
 * const store = createTtlMapStore<string>({ ttlMs: 60_000, maxSize: 100 });
 * store.set("k", "v");
 * ```
 */
export function createTtlMapStore<T>(options?: TtlMapStoreOptions): TtlMapStore<T> {
  const ttlMs = options?.ttlMs ?? 0;
  const maxSize = options?.maxSize ?? Number.POSITIVE_INFINITY;
  const cleanupIntervalMs = options?.cleanupIntervalMs;

  const memory = new Map<string, TtlEntry<T>>();
  let cleanupTimer: ReturnType<typeof setInterval> | null = null;

  function isExpired(entry: TtlEntry<T>, now: number): boolean {
    return ttlMs > 0 && now - entry.createdAt >= ttlMs;
  }

  /** 删除过期项并按 createdAt 淘汰至 maxSize / Expire + LRU trim */
  function prune(now = Date.now()): void {
    for (const [key, entry] of memory) {
      if (isExpired(entry, now)) {
        memory.delete(key);
      }
    }

    if (memory.size <= maxSize) {
      return;
    }

    const sorted = [...memory.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
    const toRemove = sorted.slice(0, memory.size - maxSize);
    for (const [key] of toRemove) {
      memory.delete(key);
    }
  }

  function set(key: string, value: T): void {
    memory.delete(key);
    memory.set(key, { value, createdAt: Date.now() });
    prune();
  }

  function get(key: string): T | undefined {
    const now = Date.now();
    const entry = memory.get(key);
    if (!entry) {
      return undefined;
    }
    if (isExpired(entry, now)) {
      memory.delete(key);
      return undefined;
    }
    return entry.value;
  }

  function del(key: string): void {
    memory.delete(key);
  }

  function clear(): void {
    memory.clear();
  }

  function size(): number {
    return memory.size;
  }

  function startCleanup(): void {
    if (!cleanupIntervalMs || cleanupTimer) {
      return;
    }
    cleanupTimer = setInterval(() => prune(), cleanupIntervalMs);
    if (cleanupTimer && typeof cleanupTimer === "object" && "unref" in cleanupTimer) {
      cleanupTimer.unref();
    }
  }

  function stopCleanup(): void {
    if (cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }
  }

  return {
    set,
    get,
    delete: del,
    clear,
    size,
    startCleanup,
    stopCleanup,
  };
}

/** ReqId 存储配置 / Options for {@link createReqIdStore} */
export interface ReqIdStoreOptions {
  /** TTL 毫秒，默认 7 天 / TTL in ms, default 7 days */
  ttlMs?: number;
  /** 内存最大条目数，默认 200 / Max in-memory entries */
  memoryMaxSize?: number;
}

/** ReqId 存储接口 / chatId → reqId mapping store */
export interface ReqIdStore {
  /** 写入 chatId 对应的 reqId / Set reqId for chat */
  set(chatId: string, reqId: string): void;
  /** 异步读取（与 getSync 行为一致，供 async 调用链）/ Async get */
  get(chatId: string): Promise<string | undefined>;
  /** 同步读取 / Sync get */
  getSync(chatId: string): string | undefined;
  /** 删除 / Delete */
  delete(chatId: string): void;
  /** 清空内存 / Clear memory */
  clearMemory(): void;
  /** 当前内存条目数 / Memory size */
  memorySize(): number;
}

const DEFAULT_REQID_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_REQID_MAX_SIZE = 200;

/**
 * 创建 chatId → reqId 的 TTL 内存存储。
 *
 * 基于 {@link createTtlMapStore}，默认 TTL 7 天、最多 200 条。
 * `_accountId` 预留多账号扩展，当前未参与键空间隔离。
 *
 * @param _accountId - 账号 ID（预留）/ Account id (reserved for future namespacing)
 * @param options - TTL 与容量 / Store options
 * @returns ReqId 存储实例 / ReqId store
 *
 * @example
 * ```ts
 * const reqIds = createReqIdStore("default", { ttlMs: 86400000 });
 * reqIds.set(chatId, reqId);
 * ```
 */
export function createReqIdStore(_accountId: string, options?: ReqIdStoreOptions): ReqIdStore {
  const store = createTtlMapStore<string>({
    ttlMs: options?.ttlMs ?? DEFAULT_REQID_TTL_MS,
    maxSize: options?.memoryMaxSize ?? DEFAULT_REQID_MAX_SIZE,
  });

  return {
    set(chatId, reqId) {
      store.set(chatId, reqId);
    },
    async get(chatId) {
      return store.get(chatId);
    },
    getSync(chatId) {
      return store.get(chatId);
    },
    delete(chatId) {
      store.delete(chatId);
    },
    clearMemory() {
      store.clear();
    },
    memorySize() {
      return store.size();
    },
  };
}
