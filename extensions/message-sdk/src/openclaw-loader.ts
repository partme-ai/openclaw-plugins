/**
 * 可选加载 OpenClaw plugin-sdk 子路径（peer 依赖，失败时返回 null）。
 */

/**
 * 动态 import `openclaw/plugin-sdk/<subpath>`。
 *
 * @param subpath 子路径，不含 `openclaw/plugin-sdk/` 前缀
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
