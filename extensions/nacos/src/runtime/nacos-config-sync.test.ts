import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyFileSync, existsSync } from "node:fs";

// --- Mocks ---
const mockGetConfig = vi.fn();
const mockSubscribe = vi.fn();
const mockUnSubscribe = vi.fn();
const mockClose = vi.fn();

vi.mock("nacos", () => ({
  NacosConfigClient: class MockNacosConfigClient {
    constructor(_opts: Record<string, unknown>) {
      // constructor body
    }
    getConfig = mockGetConfig;
    subscribe = mockSubscribe;
    unSubscribe = mockUnSubscribe;
    close = mockClose;
  },
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    copyFileSync: vi.fn(),
    existsSync: vi.fn(() => true),
  };
});

const mockCopyFileSync = vi.mocked(copyFileSync);
const mockExistsSync = vi.mocked(existsSync);

describe("NacosConfigSyncService", () => {
  let logger: ReturnType<typeof vi.fn>[];
  let testDeps: import("./nacos-config-sync.js").ConfigSyncDeps;
  let NacosConfigSyncService: typeof import("./nacos-config-sync.js").NacosConfigSyncService;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);

    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as typeof logger;

    const mod = await import("./nacos-config-sync.js");
    NacosConfigSyncService = mod.NacosConfigSyncService;

    testDeps = {
      pluginConfig: {
        serverList: "127.0.0.1:8848",
        configCenter: {
          enabled: true,
          sharedConfigs: [{ dataId: "base.yml", group: "DEFAULT_GROUP", refresh: true }],
        },
      },
      getCurrentConfig: vi.fn().mockResolvedValue({ existingKey: "val" }),
      replaceConfig: vi.fn().mockResolvedValue(undefined),
      stateDir: "/tmp/test-nacos",
      logger: logger as unknown as import("./types.js").PluginLog,
      env: {},
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("pullAndApply", () => {
    it("returns early when configCenter disabled", async () => {
      const svc = new NacosConfigSyncService();
      const deps = { ...testDeps, pluginConfig: { ...testDeps.pluginConfig, configCenter: { enabled: false } } };
      await svc.pullAndApply(deps);
      expect(mockGetConfig).not.toHaveBeenCalled();
    });

    it("throws when client not initialized", async () => {
      const svc = new NacosConfigSyncService();
      await expect(svc.pullAndApply(testDeps)).rejects.toThrow("NacosConfigClient not initialized");
    });

    it("pulls shared configs, merges, and replaces config", async () => {
      mockGetConfig.mockResolvedValue('{"nacosKey": "nacosVal"}');

      const svc = new NacosConfigSyncService();
      const client = new (await import("nacos")).NacosConfigClient({});
      svc["client"] = client as never;

      await svc.pullAndApply(testDeps);

      expect(mockGetConfig).toHaveBeenCalledWith("base.yml", "DEFAULT_GROUP");
      expect(testDeps.replaceConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          existingKey: "val",
          nacosKey: "nacosVal",
        }),
      );
    });

    it("skips empty config from Nacos but still applies (existing config unchanged)", async () => {
      mockGetConfig.mockResolvedValue("");

      const svc = new NacosConfigSyncService();
      const client = new (await import("nacos")).NacosConfigClient({});
      svc["client"] = client as never;

      await svc.pullAndApply(testDeps);
      // replaceConfig called with existing config unchanged (no merge from empty Nacos data)
      expect(testDeps.replaceConfig).toHaveBeenCalledWith(
        expect.objectContaining({ existingKey: "val" }),
      );
      expect(mockGetConfig).toHaveBeenCalledWith("base.yml", "DEFAULT_GROUP");
    });

    it("merges multiple shared configs in order", async () => {
      let callCount = 0;
      mockGetConfig.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve('{"base": "fromBase"}');
        return Promise.resolve('{"override": "fromOverride"}');
      });

      const deps = {
        ...testDeps,
        pluginConfig: {
          ...testDeps.pluginConfig,
          configCenter: {
            ...testDeps.pluginConfig.configCenter!,
            sharedConfigs: [
              { dataId: "base.yml", group: "DEFAULT_GROUP", refresh: true },
              { dataId: "override.yml", group: "DEFAULT_GROUP", refresh: true },
            ],
          },
        },
      };

      const svc = new NacosConfigSyncService();
      const client = new (await import("nacos")).NacosConfigClient({});
      svc["client"] = client as never;

      await svc.pullAndApply(deps);
      expect(deps.replaceConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          existingKey: "val",
          base: "fromBase",
          override: "fromOverride",
        }),
      );
    });

    it("applies applicationDataId config", async () => {
      mockGetConfig.mockImplementation((dataId: string) => {
        if (dataId === "application-dev.json") return Promise.resolve('{"appKey": "appVal"}');
        return Promise.resolve(null);
      });

      const deps = {
        ...testDeps,
        pluginConfig: {
          ...testDeps.pluginConfig,
          configCenter: {
            ...testDeps.pluginConfig.configCenter!,
            sharedConfigs: [],
            applicationDataId: "application-dev.json",
            profile: "dev",
          },
        },
      };

      const svc = new NacosConfigSyncService();
      const client = new (await import("nacos")).NacosConfigClient({});
      svc["client"] = client as never;

      await svc.pullAndApply(deps);
      expect(deps.replaceConfig).toHaveBeenCalledWith(
        expect.objectContaining({ appKey: "appVal" }),
      );
    });

    it("merges per-plugin configs into plugins.entries", async () => {
      mockGetConfig.mockImplementation((dataId: string) => {
        if (dataId === "my-plugin-dev.json") return Promise.resolve('{"apiKey": "sk-xxx"}');
        return Promise.resolve(null);
      });

      const deps = {
        ...testDeps,
        pluginConfig: {
          ...testDeps.pluginConfig,
          configCenter: {
            ...testDeps.pluginConfig.configCenter!,
            sharedConfigs: [],
            pluginConfigIds: ["my-plugin"],
            profile: "dev",
          },
        },
      };

      const svc = new NacosConfigSyncService();
      const client = new (await import("nacos")).NacosConfigClient({});
      svc["client"] = client as never;

      await svc.pullAndApply(deps);
      expect(deps.replaceConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          plugins: expect.objectContaining({
            entries: expect.objectContaining({
              "my-plugin": expect.objectContaining({
                config: { apiKey: "sk-xxx" },
              }),
            }),
          }),
        }),
      );
    });
  });

  describe("start", () => {
    it("creates client, runs initial pull, subscribes", async () => {
      mockGetConfig.mockResolvedValue('{"key": "val"}');

      const svc = new NacosConfigSyncService();
      await svc.start(testDeps);

      expect(mockGetConfig).toHaveBeenCalled();
      expect(testDeps.replaceConfig).toHaveBeenCalled();
      expect(mockSubscribe).toHaveBeenCalledWith(
        { dataId: "base.yml", group: "DEFAULT_GROUP" },
        expect.any(Function),
      );
    });

    it("does nothing when configCenter disabled", async () => {
      const deps = {
        ...testDeps,
        pluginConfig: { ...testDeps.pluginConfig, configCenter: { enabled: false } },
      };
      const svc = new NacosConfigSyncService();
      await svc.start(deps);
      expect(mockGetConfig).not.toHaveBeenCalled();
    });
  });

  describe("stop", () => {
    it("unsubscribes and closes client", async () => {
      mockGetConfig.mockResolvedValue('{"key": "val"}');

      const svc = new NacosConfigSyncService();
      await svc.start(testDeps);

      expect(mockSubscribe).toHaveBeenCalled();
      const unsubscribeCount = mockUnSubscribe.mock.calls.length;
      expect(unsubscribeCount).toBe(0);

      await svc.stop(logger as unknown as import("./types.js").PluginLog);

      expect(mockUnSubscribe).toHaveBeenCalled();
      expect(mockClose).toHaveBeenCalled();
    });
  });

  describe("primaryConfigDataId", () => {
    it("replaces base config with primary dataId content", async () => {
      mockGetConfig.mockImplementation((dataId: string) => {
        if (dataId === "openclaw.json") return Promise.resolve('{"gateway":{"port":9090},"hooks":{"enabled":true}}');
        return Promise.resolve(null);
      });

      const deps = {
        ...testDeps,
        pluginConfig: {
          ...testDeps.pluginConfig,
          configCenter: {
            ...testDeps.pluginConfig.configCenter!,
            sharedConfigs: [],
            primaryConfigDataId: "openclaw.json",
          },
        },
      };

      const svc = new NacosConfigSyncService();
      const client = new (await import("nacos")).NacosConfigClient({});
      svc["client"] = client as never;

      await svc.pullAndApply(deps);
      expect(deps.replaceConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          gateway: { port: 9090 },
          hooks: { enabled: true },
        }),
      );
      // existingKey from getCurrentConfig should NOT be present (replaced, not merged)
      const callArg = (deps.replaceConfig as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
      expect(callArg.existingKey).toBeUndefined();
    });

    it("falls back to current config snapshot when primary dataId is empty", async () => {
      mockGetConfig.mockImplementation((dataId: string) => {
        if (dataId === "openclaw.json") return Promise.resolve("");
        return Promise.resolve('{"nacosKey":"fromNacos"}');
      });

      const deps = {
        ...testDeps,
        pluginConfig: {
          ...testDeps.pluginConfig,
          configCenter: {
            ...testDeps.pluginConfig.configCenter!,
            sharedConfigs: [{ dataId: "extra.yml", group: "DEFAULT_GROUP", refresh: true }],
            primaryConfigDataId: "openclaw.json",
          },
        },
      };

      const svc = new NacosConfigSyncService();
      const client = new (await import("nacos")).NacosConfigClient({});
      svc["client"] = client as never;

      await svc.pullAndApply(deps);
      // Falls back to snapshot, then merges shared config on top
      expect(deps.replaceConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          existingKey: "val",
          nacosKey: "fromNacos",
        }),
      );
    });

    it("layers sharedConfigs on top of primary config", async () => {
      mockGetConfig.mockImplementation((dataId: string) => {
        if (dataId === "primary.json") return Promise.resolve('{"base":"primary","override":"fromPrimary"}');
        if (dataId === "overlay.yml") return Promise.resolve('{"overlay":"fromOverlay"}');
        return Promise.resolve(null);
      });

      const deps = {
        ...testDeps,
        pluginConfig: {
          ...testDeps.pluginConfig,
          configCenter: {
            ...testDeps.pluginConfig.configCenter!,
            primaryConfigDataId: "primary.json",
            sharedConfigs: [{ dataId: "overlay.yml", group: "DEFAULT_GROUP", refresh: true }],
          },
        },
      };

      const svc = new NacosConfigSyncService();
      const client = new (await import("nacos")).NacosConfigClient({});
      svc["client"] = client as never;

      await svc.pullAndApply(deps);
      const callArg = (deps.replaceConfig as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
      expect(callArg).toMatchObject({
        base: "primary",
        overlay: "fromOverlay",
      });
    });

    it("subscribes to primary dataId changes in start()", async () => {
      mockGetConfig.mockResolvedValue('{"key":"val"}');

      const deps = {
        ...testDeps,
        pluginConfig: {
          ...testDeps.pluginConfig,
          configCenter: {
            ...testDeps.pluginConfig.configCenter!,
            sharedConfigs: [],
            primaryConfigDataId: "openclaw.json",
          },
        },
      };

      const svc = new NacosConfigSyncService();
      await svc.start(deps);

      expect(mockSubscribe).toHaveBeenCalledWith(
        { dataId: "openclaw.json", group: "DEFAULT_GROUP" },
        expect.any(Function),
      );
    });
  });

  describe("backupOpenClawConfig", () => {
    it("copies config file to backup destination", async () => {
      const { backupOpenClawConfig, resolveConfigFileForBackup } = await import("./nacos-config-sync.js");
      const stateDir = "/tmp/test-state";

      mockExistsSync.mockReturnValue(true);
      mockCopyFileSync.mockImplementation(() => undefined);

      backupOpenClawConfig(stateDir, {}, logger as unknown as import("./types.js").PluginLog);

      expect(mockCopyFileSync).toHaveBeenCalledWith(
        expect.stringContaining(stateDir),
        expect.stringContaining(stateDir),
      );
    });

    it("skips backup when source file not found", async () => {
      const { backupOpenClawConfig } = await import("./nacos-config-sync.js");
      mockExistsSync.mockReturnValue(false);

      backupOpenClawConfig("/tmp", {}, logger as unknown as import("./types.js").PluginLog);
      expect(mockCopyFileSync).not.toHaveBeenCalled();
    });
  });
});
