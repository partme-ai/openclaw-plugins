import { vi } from "vitest";

import { createRuntimeEnv } from "./runtime-env.js";

/**
 * Minimal OpenClaw PluginApi mock for channel lifecycle tests.
 * @param {Record<string, unknown>} [overrides]
 */
export function createMockPluginApi(overrides = {}) {
  const runtimeEnv = createRuntimeEnv();
  const config = overrides.config ?? { channels: {} };

  return {
    runtime: {
      config,
      env: runtimeEnv,
      log: runtimeEnv.log,
      error: runtimeEnv.error,
    },
    registerChannel: vi.fn(),
    registerTool: vi.fn(),
    registerSkill: vi.fn(),
    ...overrides,
  };
}

/**
 * Minimal ChannelGatewayContext mock.
 * @param {Record<string, unknown>} [overrides]
 */
export function createMockChannelGatewayContext(overrides = {}) {
  const abortController = overrides.abortController ?? new AbortController();
  return {
    cfg: overrides.cfg ?? { channels: {} },
    accountId: overrides.accountId ?? "default",
    abortSignal: abortController.signal,
    log: vi.fn(),
    ...overrides,
  };
}
