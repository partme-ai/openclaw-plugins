/**
 * @module util/global-singleton
 *
 * 跨 jiti loader 实例的进程内单例 / Process-wide singleton via globalThis + Symbol.for.
 *
 * **职责**：解决 OpenClaw 多 loader / 多插件实例下模块级变量不共享的问题，
 * 以 `Symbol.for` 在 `globalThis` 上存取单例。
 *
 * **适用场景**：SessionPeerCache、ActiveReplyStore、ReqIdStore 等需跨 loader 共享的状态。
 *
 * **上下游**：
 * - 上游：routing / ingress / 各通道插件初始化
 * - 下游：`globalThis`（进程级）
 *
 * **关键导出**：`getGlobalSingleton`、`resetGlobalSingleton`
 */

/**
 * 获取或创建全局单例，解决 OpenClaw 多 loader 下模块级变量不共享的问题。
 *
 * 首次调用时执行 `factory()` 并缓存；后续同 `symbolKey` 调用返回同一实例。
 *
 * @param symbolKey - 全局唯一符号键（会经 `Symbol.for` 规范化）/ Unique symbol key
 * @param factory - 首次创建实例的工厂函数 / Factory invoked on first access
 * @returns 已存在或新创建的实例 / Cached or newly created singleton
 *
 * @example
 * ```ts
 * const cache = getGlobalSingleton("message-sdk:session-peer", () => createSessionPeerCache());
 * ```
 */
export function getGlobalSingleton<T>(symbolKey: string, factory: () => T): T {
  const sym = Symbol.for(symbolKey);
  const holder = globalThis as Record<symbol, T | undefined>;
  const existing = holder[sym];
  if (existing !== undefined) {
    return existing;
  }
  const created = factory();
  holder[sym] = created;
  return created;
}

/**
 * 重置全局单例（主要用于测试）。
 *
 * 从 `globalThis` 删除对应 Symbol 条目，下次 `getGlobalSingleton` 会重新 factory。
 *
 * @param symbolKey - 与 `getGlobalSingleton` 相同的符号键 / Same key used when creating
 *
 * @example
 * ```ts
 * afterEach(() => resetGlobalSingleton("message-sdk:session-peer"));
 * ```
 */
export function resetGlobalSingleton(symbolKey: string): void {
  const sym = Symbol.for(symbolKey);
  delete (globalThis as Record<symbol, unknown>)[sym];
}
