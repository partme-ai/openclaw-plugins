/**
 * @module openclaw/loader
 *
 * OpenClaw plugin-sdk 可选动态加载 / Optional dynamic import of OpenClaw plugin-sdk subpaths.
 *
 * **职责**：以 peer 依赖方式动态 `import('openclaw/plugin-sdk/<subpath>')`；
 * 测试环境或 import 失败时返回 `null`，不抛错。
 *
 * **适用场景**：`format-error`、compat 类型、pairing 存储等需 OpenClaw 能力但 SDK 非硬依赖的模块。
 *
 * **上下游**：
 * - 上游：message-sdk 各 util / ingress / openclaw 封装
 * - 下游：已安装的 `openclaw` 包 plugin-sdk 子路径
 *
 * **关键导出**：`importOpenClawPluginSdk`
 */

/**
 * 动态 import `openclaw/plugin-sdk/<subpath>`。
 *
 * - 测试环境（`VITEST` 或 `NODE_ENV=test`）直接返回 `null`
 * - 去掉 leading `/` 与 trailing `.js` 后拼接子路径
 * - import 失败时 catch 并返回 `null`（不抛出）
 *
 * @param subpath - 子路径，不含 `openclaw/plugin-sdk/` 前缀 / Subpath without prefix
 * @returns 模块命名空间或 `null` / Module exports or null if unavailable
 *
 * @example
 * ```ts
 * const sdk = await importOpenClawPluginSdk<{ formatErrorMessage?: (e: unknown) => string }>(
 *   "error-runtime",
 * );
 * ```
 */
export async function importOpenClawPluginSdk<T extends Record<string, unknown>>(
  subpath: string,
): Promise<T | null> {
  if (process.env.VITEST != null || process.env.NODE_ENV === "test") {
    return null;
  }
  const trimmed = subpath.replace(/^\/+/, "").replace(/\.js$/, "");
  try {
    const mod = await import(
      /* @vite-ignore */ `openclaw/plugin-sdk/${trimmed}`,
    );
    return mod as T;
  } catch {
    return null;
  }
}
