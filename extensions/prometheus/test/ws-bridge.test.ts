import { beforeEach, describe, expect, it, vi } from "vitest";

const requestMock = vi.fn();
const startMock = vi.fn();
let lastCtorOptions: Record<string, unknown> | null = null;

vi.mock("openclaw/plugin-sdk/gateway-runtime", () => {
  class MockGatewayClient {
    constructor(options: Record<string, unknown>) {
      lastCtorOptions = options;
    }

    start(): void {
      startMock();
      const onHelloOk = lastCtorOptions?.onHelloOk;
      if (typeof onHelloOk === "function") {
        onHelloOk({});
      }
    }

    request(method: string, params?: unknown): Promise<unknown> {
      return requestMock(method, params);
    }
  }

  return { GatewayClient: MockGatewayClient };
});

describe("ws-bridge", () => {
  beforeEach(() => {
    vi.resetModules();
    requestMock.mockReset();
    startMock.mockReset();
    lastCtorOptions = null;
  });

  it("creates a GatewayClient from runtime config and proxies rpcCall", async () => {
    const bridge = await import("../src/runtime/ws-bridge.js");
    const { initializeRuntimeStore } = await import("../src/runtime/store.js");
    const { resolvePrometheusConfig } = await import("../src/config/plugin-config.js");

    initializeRuntimeStore(
      {
        config: {},
        runtime: {},
      } as never,
      resolvePrometheusConfig({ instance: "test" }),
    );

    bridge.setRuntime({
      config: {
        gateway: {
          port: 18789,
          auth: { token: "tok-1", password: "pw-1" },
        },
      },
    } as never);

    requestMock.mockResolvedValueOnce({ ok: true, count: 67 });

    await expect(bridge.rpcCall("sessions.list", { limit: 1 })).resolves.toEqual({
      ok: true,
      count: 67,
    });

    expect(startMock).toHaveBeenCalledTimes(1);
    expect(lastCtorOptions).toMatchObject({
      url: "ws://127.0.0.1:18789",
      token: "tok-1",
      password: "pw-1",
      role: "operator",
      scopes: ["operator.read", "operator.write"],
    });
    expect(requestMock).toHaveBeenCalledWith("sessions.list", { limit: 1 });
  });

  it("returns null entries for failed rpcBatch items", async () => {
    const bridge = await import("../src/runtime/ws-bridge.js");
    const { initializeRuntimeStore } = await import("../src/runtime/store.js");
    const { resolvePrometheusConfig } = await import("../src/config/plugin-config.js");

    initializeRuntimeStore(
      {
        config: {},
        runtime: {},
      } as never,
      resolvePrometheusConfig({ instance: "test" }),
    );

    bridge.setRuntime({
      config: {
        gateway: {
          port: 18789,
        },
      },
    } as never);

    requestMock.mockResolvedValueOnce({ ok: true });
    requestMock.mockRejectedValueOnce(new Error("boom"));

    await expect(
      bridge.rpcBatch([
        ["health", {}],
        ["node.list", {}],
      ]),
    ).resolves.toEqual([{ ok: true }, null]);
  });
});
