/**
 * 统一错误文案（对齐 OpenClaw error-runtime）。
 */

import { importOpenClawPluginSdk } from "../openclaw-loader.js";

/**
 * 将 unknown 错误格式化为可读字符串。
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

/** 同步 fallback（不加载 OpenClaw）。 */
export function formatErrorMessageSync(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === "string") return error;
  return String(error);
}
