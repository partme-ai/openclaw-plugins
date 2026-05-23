/**
 * WeCom 插件运行时持有（runtime）
 *
 * 使用 openclaw plugin-sdk runtime-store 保存 PluginRuntime 单例，
 * 供 channel outbound 分块、config 写入、配对通知等访问 OpenClaw 核心能力。
 */
import type { PluginRuntime } from "openclaw/plugin-sdk/core";
import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";

const { setRuntime: setWeComRuntime, getRuntime: getWeComRuntime } = createPluginRuntimeStore<PluginRuntime>("WeCom runtime not initialized");

export { setWeComRuntime, getWeComRuntime };
