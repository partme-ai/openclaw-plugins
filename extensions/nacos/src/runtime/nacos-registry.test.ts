import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ready: vi.fn().mockResolvedValue(undefined),
  registerInstance: vi.fn().mockResolvedValue(undefined),
  deregisterInstance: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("nacos", () => ({
  NacosNamingClient: class MockNacosNamingClient {
    ready = mocks.ready;
    registerInstance = mocks.registerInstance;
    deregisterInstance = mocks.deregisterInstance;
    close = mocks.close;
  },
}));

describe("GatewayNacosRegistry", () => {
  it("registers instance with hooks metadata", async () => {
    mocks.ready.mockClear();
    mocks.registerInstance.mockClear();
    mocks.deregisterInstance.mockClear();
    mocks.close.mockClear();

    const { GatewayNacosRegistry, buildInstanceMetadata } = await import("./nacos-registry.js");

    const meta = buildInstanceMetadata({
      cfg: {
        gateway: { port: 18789 },
        hooks: { enabled: true, path: "/hooks" },
      },
      plugin: {
        serverList: "127.0.0.1:8848",
        metadata: { team: "a", gatewayPort: "1", provider: "spoofed" },
      },
      port: 18789,
    });
    expect(meta.hooksEnabled).toBe("true");
    expect(meta.hooksBasePath).toBe("/hooks");
    expect(meta.gatewayPort).toBe("18789");
    expect(meta.team).toBe("a");
    expect(meta.gatewayPort).toBe("18789");
    expect(meta.provider).toBe("openclaw-nacos");

    const reg = new GatewayNacosRegistry();
    await reg.register({
      pluginConfig: {
        serverList: "127.0.0.1:8848",
        namespace: "public",
        serviceName: "test-svc",
        groupName: "DEFAULT_GROUP",
      },
      openClawConfig: {
        hooks: { enabled: true, path: "/hooks" },
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
    });

    expect(mocks.ready).toHaveBeenCalled();
    expect(mocks.registerInstance).toHaveBeenCalledWith(
      "test-svc",
      expect.objectContaining({
        ip: expect.any(String),
        port: expect.any(Number),
        metadata: expect.objectContaining({
          hooksBasePath: "/hooks",
          hooksEnabled: "true",
        }),
      }),
      "DEFAULT_GROUP",
    );

    await reg.stop({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    });
    expect(mocks.deregisterInstance).toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalled();
  });

  it("注册失败时关闭已创建的 Naming 客户端", async () => {
    mocks.close.mockClear();
    mocks.registerInstance.mockRejectedValueOnce(new Error("register failed"));
    const { GatewayNacosRegistry } = await import("./nacos-registry.js");
    const reg = new GatewayNacosRegistry();

    await expect(reg.register({
      pluginConfig: { serverList: "127.0.0.1:8848" },
      openClawConfig: {},
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    })).rejects.toThrow("register failed");
    expect(mocks.close).toHaveBeenCalledOnce();
  });
});
