import { beforeEach, describe, expect, it, vi } from "vitest";

const bridgeState = vi.hoisted(() => ({
  active: null as object | null,
  startError: null as Error | null,
  summary: { enabled: true, state: "logged_in" } as Record<string, unknown>,
  starts: vi.fn(),
  stops: vi.fn(),
}));

vi.mock("../src/transport/ipad-bridge.js", () => {
  class MockBridge {
    constructor(readonly config: unknown) {}
    on() {
      return () => {};
    }
    async start() {
      bridgeState.starts();
      if (bridgeState.startError) throw bridgeState.startError;
    }
    async stop() {
      bridgeState.stops();
    }
  }
  return {
    WechatIpadBridge: MockBridge,
    setActiveBridge: (bridge: object | null) => {
      bridgeState.active = bridge;
    },
    clearActiveBridge: (bridge: object) => {
      if (bridgeState.active !== bridge) return false;
      bridgeState.active = null;
      return true;
    },
    getBridgeStatusSummary: () => bridgeState.summary,
    sendMessage: vi.fn().mockResolvedValue({ ok: true, data: { msgId: "reply-1" } }),
  };
});

import { wechatIpadChannel } from "../src/channel.js";

function channelConfig(required = true) {
  return {
    channels: {
      "wechat-ipad": {
        enabled: true,
        acknowledgeUnofficialProtocolRisk: true,
        required,
        message: { allowFrom: ["wxid-owner"] },
      },
    },
  };
}

function gatewayContext(required = true) {
  const cfg = channelConfig(required);
  const account = wechatIpadChannel.config.resolveAccount(cfg as never, "default");
  const controller = new AbortController();
  return {
    controller,
    account,
    setStatus: vi.fn(),
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    abortSignal: controller.signal,
  };
}

describe("wechat-ipad Channel lifecycle", () => {
  beforeEach(() => {
    bridgeState.active = null;
    bridgeState.startError = null;
    bridgeState.summary = { enabled: true, state: "logged_in" };
    bridgeState.starts.mockClear();
    bridgeState.stops.mockClear();
  });

  it("starts through gateway.startAccount and owns cleanup until AbortSignal", async () => {
    const ctx = gatewayContext();
    const running = wechatIpadChannel.gateway!.startAccount!(ctx as never);
    await vi.waitFor(() => expect(bridgeState.starts).toHaveBeenCalledOnce());
    expect(ctx.setStatus).toHaveBeenCalledWith(expect.objectContaining({ running: true }));

    ctx.controller.abort();
    await running;
    expect(bridgeState.stops).toHaveBeenCalledOnce();
    expect(bridgeState.active).toBeNull();
    expect(ctx.setStatus).toHaveBeenLastCalledWith(expect.objectContaining({ running: false }));
  });

  it("fails required startup but keeps optional startup alive for background reconnect", async () => {
    bridgeState.startError = new Error("bridge unavailable");
    const required = gatewayContext(true);
    await expect(wechatIpadChannel.gateway!.startAccount!(required as never))
      .rejects.toThrow("bridge unavailable");
    expect(required.setStatus).toHaveBeenCalledWith(expect.objectContaining({
      running: false,
      lastError: "bridge unavailable",
    }));

    const optional = gatewayContext(false);
    const running = wechatIpadChannel.gateway!.startAccount!(optional as never);
    await vi.waitFor(() => expect(optional.log.warn).toHaveBeenCalledWith(expect.stringContaining("reconnecting")));
    optional.controller.abort();
    await running;
  });

  it("reports business readiness only after the bridge confirms logged_in", async () => {
    bridgeState.summary = { enabled: true, state: "connected" };
    await expect(wechatIpadChannel.status!.probeAccount!({} as never)).resolves.toEqual({ ok: false });
    bridgeState.summary = { enabled: true, state: "logged_in" };
    await expect(wechatIpadChannel.status!.probeAccount!({} as never)).resolves.toEqual({ ok: true });

    const account = wechatIpadChannel.config.resolveAccount(channelConfig() as never, "default");
    expect(wechatIpadChannel.status!.buildAccountSnapshot!({ account, runtime: { running: true } } as never))
      .toMatchObject({ accountId: "default", configured: true, state: "logged_in" });
    expect(wechatIpadChannel.messaging!.normalizeTarget!("wechat-ipad:wxid-owner")).toBe("wxid-owner");
  });
});
