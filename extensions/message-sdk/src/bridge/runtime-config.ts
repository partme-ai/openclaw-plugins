import type { BridgePluginRuntime } from "./types.js";

/**
 * 从 PluginRuntime 解析当前 OpenClaw 配置快照。
 *
 * 新宿主通过异步 `config.current()` 暴露快照，旧兼容形态直接提供对象；两条路径最终
 * 都必须得到普通对象，避免 Bridge 把 Promise、数组或空值误当配置继续运行。
 */
export async function resolveBridgeRuntimeConfig(
  runtime: BridgePluginRuntime,
): Promise<Record<string, unknown>> {
  const configRuntime = runtime.config;
  if (typeof configRuntime.current === "function") {
    const current = await configRuntime.current();
    if (!isRecord(current)) {
      throw new Error("[message-sdk] runtime.config.current() returned a non-object config");
    }
    return current;
  }
  return configRuntime;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
