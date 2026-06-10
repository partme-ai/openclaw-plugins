/**
 * @module wecom-kf/runtime
 *
 * WeCom KF 插件 **PluginRuntime 单例持有**。
 *
 * **职责**：
 * - Gateway `registerFull` 时 `setWecomRuntime`
 * - dispatch / webhook / agent 层通过 `getWecomRuntime` 访问 OpenClaw 核心 API
 *
 * **关键导出**：`setWecomRuntime`、`getWecomRuntime`
 */

import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | null = null;

/**
 * 注入 KF 插件运行时（register 阶段调用一次）。
 *
 * @param next - Gateway 提供的 PluginRuntime
 */
export function setWecomRuntime(next: PluginRuntime): void {
  runtime = next;
}

/**
 * 获取已注入的 PluginRuntime；未初始化时抛错。
 *
 * @throws 当 register 尚未调用 `setWecomRuntime` 时
 */
export function getWecomRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("WeCom runtime not initialized");
  }
  return runtime;
}
