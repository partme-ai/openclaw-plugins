/**
 * 抖音插件运行时存取模块。
 *
 * **架构角色**：在 OpenClaw 完成 `setRuntime` 后，Webhook 与 Gateway 可通过
 * `getDouyinRuntime()` 访问 `PluginRuntime`（config、channel reply 等）。
 *
 * **关键依赖**：`openclaw/plugin-sdk/runtime-store`、`openclaw/plugin-sdk/core`
 */
import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";
import type { PluginRuntime } from "openclaw/plugin-sdk/core";

const { getRuntime: getDouyinRuntime, setRuntime: setDouyinRuntime } =
  createPluginRuntimeStore<PluginRuntime>("Douyin plugin runtime not initialized");

/** 获取已注入的 PluginRuntime；未初始化时抛错 */
export { getDouyinRuntime, setDouyinRuntime };
