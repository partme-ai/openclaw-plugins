/**
 * Nacos 插件入口契约测试：验证 2026.7.1 Service 生命周期、失败策略与诊断脱敏。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configStart: vi.fn(),
  configStop: vi.fn(),
  namingRegister: vi.fn(),
  namingStop: vi.fn(),
  clusterStart: vi.fn(),
  clusterStop: vi.fn(),
}));

vi.mock("./runtime/nacos-config-sync.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./runtime/nacos-config-sync.js")>();
  return {
    ...actual,
    NacosConfigSyncService: class {
      start = mocks.configStart;
      stop = mocks.configStop;
    },
  };
});

vi.mock("./runtime/nacos-registry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./runtime/nacos-registry.js")>();
  return {
    ...actual,
    GatewayNacosRegistry: class {
      register = mocks.namingRegister;
      stop = mocks.namingStop;
    },
  };
});

vi.mock("./runtime/nacos-cluster.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./runtime/nacos-cluster.js")>();
  return {
    ...actual,
    WebhookClusterService: class {
      start = mocks.clusterStart;
      stop = mocks.clusterStop;
      getState() {
        return {
          peers: [{
            ip: "10.0.0.2",
            port: 18789,
            serviceName: "openclaw-gateway",
            groupName: "DEFAULT_GROUP",
            weight: 1,
            healthy: true,
            metadata: { hooksBasePath: "/hooks", apiKey: "must-not-leak" },
          }],
          lastUpdated: Date.now(),
        };
      }
    },
  };
});

import plugin from "./index.js";

function createHarness(startupFailurePolicy?: "fail" | "degrade") {
  const services = new Map<string, { start: (ctx: unknown) => Promise<void>; stop: (ctx: unknown) => Promise<void> }>();
  const routes = new Map<string, { handler: (req: unknown, res: unknown) => Promise<void> }>();
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const api = {
    registrationMode: "full",
    pluginConfig: {
      serverList: "127.0.0.1:8848",
      ...(startupFailurePolicy ? { startupFailurePolicy } : {}),
    },
    runtime: {
      config: {
        current: vi.fn(() => ({})),
        replaceConfigFile: vi.fn().mockResolvedValue(undefined),
      },
    },
    registerService(service: { id: string; start: (ctx: unknown) => Promise<void>; stop: (ctx: unknown) => Promise<void> }) {
      services.set(service.id, service);
    },
    registerHttpRoute(route: { path: string; handler: (req: unknown, res: unknown) => Promise<void> }) {
      routes.set(route.path, route);
    },
  };
  plugin.register(api as never);
  const context = { config: { gateway: { port: 18789 } }, stateDir: "/tmp/nacos-test", logger };
  return { services, routes, context };
}

function responseCapture() {
  return {
    status: 0,
    body: "",
    writeHead(status: number) { this.status = status; },
    end(body: string) { this.body = body; },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.configStart.mockResolvedValue(undefined);
  mocks.configStop.mockResolvedValue(undefined);
  mocks.namingRegister.mockResolvedValue(undefined);
  mocks.namingStop.mockResolvedValue(undefined);
  mocks.clusterStart.mockResolvedValue(undefined);
  mocks.clusterStop.mockResolvedValue(undefined);
});

describe("nacos plugin entry", () => {
  it("默认 fail 策略会把 Naming 初始化失败传播给 Gateway", async () => {
    mocks.namingRegister.mockRejectedValueOnce(new Error("password=secret connection refused"));
    const { services, context } = createHarness();

    await expect(services.get("openclaw-nacos-naming")?.start(context)).rejects.toThrow(
      "connection refused",
    );
  });

  it("degrade 策略保留 Gateway，并且其它组件成功不会覆盖 Naming 错误", async () => {
    mocks.namingRegister.mockRejectedValueOnce(new Error("password=secret connection refused"));
    const { services, routes, context } = createHarness("degrade");
    await services.get("openclaw-nacos-naming")?.start(context);
    await services.get("openclaw-nacos-cluster")?.start(context);

    const response = responseCapture();
    await routes.get("/nacos/health")?.handler({}, response);
    const body = JSON.parse(response.body) as Record<string, any>;
    expect(body.status).toBe("degraded");
    expect(body.errors.naming).toContain("password=[REDACTED]");
    expect(body.errors.naming).not.toContain("secret");
  });

  it("cluster 诊断路由隐藏 metadata 中的凭据", async () => {
    const { services, routes, context } = createHarness("degrade");
    await services.get("openclaw-nacos-cluster")?.start(context);

    const response = responseCapture();
    await routes.get("/nacos/cluster")?.handler({}, response);
    const body = JSON.parse(response.body) as Record<string, any>;
    expect(body.peers[0].metadata).toEqual({
      hooksBasePath: "/hooks",
      apiKey: "[REDACTED]",
    });
  });
});
