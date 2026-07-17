/**
 * Bot WebSocket 生命周期契约。
 *
 * 这些测试不验证企业微信 SDK 的网络实现，而是验证插件与 OpenClaw 的资源所有权边界：
 * - 启动前已中止时不得建立“幽灵连接”；
 * - 正常启动后，abort 必须断开 SDK、清理账号状态并使监控任务结束。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const sdkState = vi.hoisted(() => ({
  instances: [] as Array<{
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
  }>,
}));

const stateMocks = vi.hoisted(() => ({
  startMessageStateCleanup: vi.fn(),
  stopMessageStateCleanup: vi.fn(),
  cleanupAccount: vi.fn(async () => undefined),
  warmupReqIdStore: vi.fn(async () => 0),
}));

vi.mock("@wecom/aibot-node-sdk", () => {
  class WSAuthFailureError extends Error {}
  class WSReconnectExhaustedError extends Error {}
  class WSClient {
    connect = vi.fn();
    disconnect = vi.fn();
    on = vi.fn();

    constructor() {
      sdkState.instances.push(this);
    }
  }
  return { WSClient, WSAuthFailureError, WSReconnectExhaustedError };
});

vi.mock("../state/state-manager.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../state/state-manager.js")>();
  return {
    ...actual,
    startMessageStateCleanup: stateMocks.startMessageStateCleanup,
    stopMessageStateCleanup: stateMocks.stopMessageStateCleanup,
    cleanupAccount: stateMocks.cleanupAccount,
    warmupReqIdStore: stateMocks.warmupReqIdStore,
  };
});

import { monitorWeComProvider } from "./ws-monitor.js";

const account = {
  accountId: "lifecycle-test",
  botId: "bot-id",
  secret: "bot-secret",
  websocketUrl: "wss://example.invalid/ws",
  config: {},
} as never;

const runtime = { log: vi.fn(), error: vi.fn() } as never;

describe("monitorWeComProvider lifecycle", () => {
  beforeEach(() => {
    sdkState.instances.length = 0;
    vi.clearAllMocks();
  });

  it("does not construct or connect WSClient when startup was already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await monitorWeComProvider({
      account,
      config: {} as never,
      runtime,
      abortSignal: controller.signal,
    });

    expect(sdkState.instances).toHaveLength(0);
    expect(stateMocks.startMessageStateCleanup).toHaveBeenCalledWith("lifecycle-test");
    expect(stateMocks.stopMessageStateCleanup).toHaveBeenCalledWith("lifecycle-test");
    expect(stateMocks.cleanupAccount).toHaveBeenCalledWith("lifecycle-test");
  });

  it("disconnects and cleans account state exactly once on abort", async () => {
    const controller = new AbortController();
    const monitoring = monitorWeComProvider({
      account,
      config: {} as never,
      runtime,
      abortSignal: controller.signal,
    });

    await vi.waitFor(() => expect(sdkState.instances).toHaveLength(1));
    await vi.waitFor(() => expect(sdkState.instances[0]?.connect).toHaveBeenCalledTimes(1));

    controller.abort();
    await monitoring;

    expect(sdkState.instances[0]?.disconnect).toHaveBeenCalledTimes(1);
    expect(stateMocks.stopMessageStateCleanup).toHaveBeenCalledTimes(1);
    expect(stateMocks.cleanupAccount).toHaveBeenCalledTimes(1);
  });
});
