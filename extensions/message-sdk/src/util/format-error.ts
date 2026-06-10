/**
 * @module util/format-error
 *
 * 统一错误文案格式化 / Unified error message formatting.
 *
 * **职责**：将 `unknown` 错误转为用户/日志可读字符串；优先委托 OpenClaw
 * `error-runtime` 子模块，不可用时本地 fallback。
 *
 * **适用场景**：出站回复错误提示、日志记录、catch 块统一文案。
 *
 * **上下游**：
 * - 上游：dispatch / reply / 各通道插件 catch 块
 * - 下游：`openclaw/plugin-sdk/error-runtime`（可选 peer 依赖）
 *
 * **关键导出**：`formatErrorMessage`、`formatErrorMessageSync`
 */

import { importOpenClawPluginSdk } from "../openclaw/loader.js";

/**
 * 将 unknown 错误格式化为可读字符串（异步，可加载 OpenClaw SDK）。
 *
 * 优先调用 OpenClaw `formatErrorMessage`；SDK 不可用时依次尝试
 * `Error.message` → 字符串 → `JSON.stringify` → `String()`。
 *
 * @param error - 任意捕获的错误值 / Caught error of any shape
 * @returns 格式化后的错误文案 / Human-readable error string
 *
 * @example
 * ```ts
 * try {
 *   await risky();
 * } catch (e) {
 *   reply(await formatErrorMessage(e));
 * }
 * ```
 */
export async function formatErrorMessage(error: unknown): Promise<string> {
  const sdk = await importOpenClawPluginSdk<{
    formatErrorMessage?: (e: unknown) => string;
  }>("error-runtime");

  if (typeof sdk?.formatErrorMessage === "function") {
    return sdk.formatErrorMessage(error);
  }

  if (error instanceof Error) return error.message || error.name;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * 同步 fallback 错误格式化（不加载 OpenClaw SDK）。
 *
 * 适用于启动阶段、测试或禁止动态 import 的场景。
 *
 * @param error - 任意捕获的错误值 / Caught error of any shape
 * @returns 格式化后的错误文案 / Human-readable error string
 *
 * @example
 * ```ts
 * logger.error(formatErrorMessageSync(err));
 * ```
 */
export function formatErrorMessageSync(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === "string") return error;
  return String(error);
}
