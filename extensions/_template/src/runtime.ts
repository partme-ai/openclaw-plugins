let runtime: Record<string, unknown> | undefined;

/**
 * 注入 OpenClaw PluginRuntime（由 defineChannelPluginEntry 回调）。
 */
export function setRuntime(rt: Record<string, unknown>): void {
  runtime = rt;
}

/**
 * 获取已注入的运行时；未初始化时抛出。
 */
export function getRuntime(): Record<string, unknown> {
  if (!runtime) {
    throw new Error("Runtime not initialized");
  }
  return runtime;
}
