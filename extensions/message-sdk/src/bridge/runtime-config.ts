import type { BridgePluginRuntime } from "./types.js";

/** Resolve the current OpenClaw config snapshot from the PluginRuntime API. */
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
