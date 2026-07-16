import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

export type BridgeRuntime = Pick<OpenClawPluginApi, "runtime" | "logger">;

let currentRuntime: BridgeRuntime | null = null;

export function bridgeRuntime(api: OpenClawPluginApi): BridgeRuntime {
  return { runtime: api.runtime, logger: api.logger };
}

/** Store the active full-registration runtime for diagnostic and extension consumers. */
export function setBridgeRuntime(api: OpenClawPluginApi): BridgeRuntime {
  const value = bridgeRuntime(api);
  currentRuntime = value;
  return value;
}

/** Return the active runtime after full plugin registration. */
export function getBridgeRuntime(): BridgeRuntime | null {
  return currentRuntime;
}

/** Clear the process-local runtime reference during explicit teardown or tests. */
export function clearBridgeRuntime(): void {
  currentRuntime = null;
}
