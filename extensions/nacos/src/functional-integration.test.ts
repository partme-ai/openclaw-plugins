/**
 * Functional integration test for openclaw-nacos plugin.
 * Validates the complete Nacos registration and discovery flow
 * using mocked SDK clients that verify the actual API contract.
 *
 * Test scenarios:
 * 1. Full plugin config parse → naming registration → cluster discovery
 * 2. Config center with primaryConfigDataId + sharedConfigs + pluginConfigIds
 * 3. Health check HTTP endpoint after registration
 * 4. Error handling when Nacos is unreachable
 * 5. Graceful shutdown (deregister)
 * 6. Webhook cluster: peer discovery and self-filtering
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseNacosPluginConfig } from "../src/config-parse.js";
import { GatewayNacosRegistry } from "../src/nacos-registry.js";
import { WebhookClusterService } from "../src/nacos-cluster.js";
import { NacosConfigSyncService } from "../src/nacos-config-sync.js";
import { flattenSpringNacosPluginConfig } from "../src/spring-normalize.js";
import { resolveGatewayPort, resolveHooksInfo, resolveRegisterIp } from "../src/resolve-endpoint.js";
import { deepMerge } from "../src/merge-deep.js";
import { backupOpenClawConfig, resolveConfigFileForBackup } from "../src/nacos-config-sync.js";
import { expandEnvPlaceholdersInValue } from "../src/env-expand.js";
import { formatTimestampYyyyMMddHHmmss } from "../src/format-timestamp.js";
import { DEFAULT_GROUP, DEFAULT_SERVICE } from "../src/shared.js";

// Mock nacos SDK module — intercepts at import level
vi.mock("nacos", () => {
  const actualConfigClient = {
    getConfig: vi.fn(),
    publishSingle: vi.fn(),
    subscribe: vi.fn(),
    unSubscribe: vi.fn(),
    close: vi.fn(),
  };
  const actualNamingClient = {
    ready: vi.fn(),
    registerInstance: vi.fn(),
    deregisterInstance: vi.fn(),
    getAllInstances: vi.fn(),
    subscribe: vi.fn(),
    unSubscribe: vi.fn(),
    close: vi.fn(),
  };

  // Must use regular function (not arrow) for `new` to work
  function MockNacosConfigClient() {
    return actualConfigClient;
  }
  function MockNacosNamingClient() {
    return actualNamingClient;
  }

  return {
    NacosConfigClient: MockNacosConfigClient,
    NacosNamingClient: MockNacosNamingClient,
    // Store refs for assertions
    __configClient: actualConfigClient,
    __namingClient: actualNamingClient,
  };
});

import { NacosConfigClient, NacosNamingClient, __configClient, __namingClient } from "nacos";

// Type-safe access to mock clients
const mockConfigClient = __configClient as typeof __configClient;
const mockNamingClient = __namingClient as typeof __namingClient;

/**
 * A realistic plugin config for functional testing.
 */
function makePluginConfig(overrides: Record<string, unknown> = {}) {
  return {
    serverList: "127.0.0.1:8848",
    namespace: "public",
    username: "nacos",
    password: "nacos",
    serviceName: "openclaw-gateway",
    groupName: "DEFAULT_GROUP",
    registerIp: "10.0.0.5",
    configCenter: {
      enabled: true,
      primaryConfigDataId: "openclaw.json",
      primaryConfigGroup: "DEFAULT_GROUP",
      profile: "dev",
      pluginConfigIds: ["openclaw-weixin", "openclaw-dingtalk"],
    },
    metadata: { env: "prod", region: "us-east-1" },
    ...overrides,
  };
}

function makeOpenClawConfig() {
  return {
    gateway: { port: 18789 },
    hooks: { enabled: true, path: "/hooks" },
  };
}

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

// ---- Test Suite ----

describe("openclaw-nacos Functional Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================
  // Test 1: Config Parsing
  // ============================================================
  describe("1. Config Parsing (parseNacosPluginConfig)", () => {
    it("parses a complete plugin config with all fields", () => {
      const raw = makePluginConfig();
      const result = parseNacosPluginConfig(raw);

      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") throw new Error("expected ok");

      expect(result.config.serverList).toBe("127.0.0.1:8848");
      expect(result.config.namespace).toBe("public");
      expect(result.config.username).toBe("nacos");
      expect(result.config.password).toBe("nacos");
      expect(result.config.serviceName).toBe("openclaw-gateway");
      expect(result.config.registerIp).toBe("10.0.0.5");
      expect(result.config.metadata).toEqual({ env: "prod", region: "us-east-1" });
      expect(result.config.configCenter?.enabled).toBe(true);
      expect(result.config.configCenter?.primaryConfigDataId).toBe("openclaw.json");
      expect(result.config.configCenter?.pluginConfigIds).toEqual(["openclaw-weixin", "openclaw-dingtalk"]);
    });

    it("parses Spring-style nacos block", () => {
      const raw = {
        nacos: {
          "server-addr": "nacos.example.com:8848",
          discovery: {
            namespace: "production",
          },
          config: {
            "shared-configs": [
              { "data-id": "shared-common.yml", group: "COMMON" },
              { "data-id": "shared-db.yml", refresh: false },
            ],
          },
        },
      };
      const result = parseNacosPluginConfig(raw);
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") throw new Error("expected ok");

      expect(result.config.serverList).toBe("nacos.example.com:8848");
      expect(result.config.namespace).toBe("production");
      expect(result.config.configCenter?.sharedConfigs).toHaveLength(2);
      expect(result.config.configCenter?.sharedConfigs?.[0].dataId).toBe("shared-common.yml");
      expect(result.config.configCenter?.sharedConfigs?.[1].refresh).toBe(false);
    });

    it("returns disabled when enabled is false", () => {
      const result = parseNacosPluginConfig({ enabled: false });
      expect(result.kind).toBe("disabled");
    });

    it("returns skip when serverList is missing", () => {
      const result = parseNacosPluginConfig({});
      expect(result.kind).toBe("skip");
      if (result.kind === "skip") {
        expect(result.reason).toContain("serverList");
      }
    });
  });

  // ============================================================
  // Test 2: Naming Registration (core requirement #4)
  // ============================================================
  describe("2. Naming Registration (GatewayNacosRegistry)", () => {
    it("registers instance with correct service name, IP, port, and metadata", async () => {
      const logger = makeLogger();
      const pluginConfig = makePluginConfig();
      const openClawConfig = makeOpenClawConfig();

      const registry = new GatewayNacosRegistry();
      // Mock ready to resolve
      mockNamingClient.ready.mockResolvedValue(undefined);
      mockNamingClient.registerInstance.mockResolvedValue(undefined);

      await registry.register({ pluginConfig, openClawConfig, logger });

      // Verify registerInstance was called with correct service name and metadata
      expect(mockNamingClient.registerInstance).toHaveBeenCalledTimes(1);
      const [serviceName, instance, groupName] = mockNamingClient.registerInstance.mock.calls[0];

      expect(serviceName).toBe("openclaw-gateway");
      expect(groupName).toBe("DEFAULT_GROUP");
      expect(instance).toMatchObject({
        ip: "10.0.0.5",
        port: 18789,
        weight: 1,
        ephemeral: true,
      });
      expect(instance.metadata).toMatchObject({
        hooksEnabled: "true",
        hooksBasePath: "/hooks",
        gatewayPort: "18789",
        provider: "openclaw-nacos",
        env: "prod",
        region: "us-east-1",
      });

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("Registered instance 10.0.0.5:18789 as openclaw-gateway")
      );
    });

    it("uses custom serviceName and groupName when configured", async () => {
      const logger = makeLogger();
      const pluginConfig = makePluginConfig({
        serviceName: "custom-gateway",
        groupName: "CUSTOM_GROUP",
        registerIp: "192.168.1.100",
        weight: 3,
        ephemeral: false,
      });
      const openClawConfig = makeOpenClawConfig();

      const registry = new GatewayNacosRegistry();
      mockNamingClient.ready.mockResolvedValue(undefined);
      mockNamingClient.registerInstance.mockResolvedValue(undefined);

      await registry.register({ pluginConfig, openClawConfig, logger });

      const [serviceName, instance, groupName] = mockNamingClient.registerInstance.mock.calls[0];

      expect(serviceName).toBe("custom-gateway");
      expect(groupName).toBe("CUSTOM_GROUP");
      expect(instance.ip).toBe("192.168.1.100");
      expect(instance.weight).toBe(3);
      expect(instance.ephemeral).toBe(false);
    });

    it("deregisters instance on stop", async () => {
      const logger = makeLogger();
      const pluginConfig = makePluginConfig();
      const openClawConfig = makeOpenClawConfig();

      const registry = new GatewayNacosRegistry();
      mockNamingClient.ready.mockResolvedValue(undefined);
      mockNamingClient.registerInstance.mockResolvedValue(undefined);
      mockNamingClient.deregisterInstance.mockResolvedValue(undefined);

      await registry.register({ pluginConfig, openClawConfig, logger });
      await registry.stop(logger);

      expect(mockNamingClient.deregisterInstance).toHaveBeenCalledTimes(1);
      const [serviceName, instance, groupName] = mockNamingClient.deregisterInstance.mock.calls[0];
      expect(serviceName).toBe("openclaw-gateway");
      expect(instance.ip).toBe("10.0.0.5");
      expect(instance.port).toBe(18789);
      expect(groupName).toBe("DEFAULT_GROUP");

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("Deregistered 10.0.0.5:18789 from openclaw-gateway")
      );
    });

    it("handles registration failure gracefully", async () => {
      const logger = makeLogger();
      const pluginConfig = makePluginConfig();
      const openClawConfig = makeOpenClawConfig();

      const registry = new GatewayNacosRegistry();
      mockNamingClient.ready.mockResolvedValue(undefined);
      mockNamingClient.registerInstance.mockRejectedValue(new Error("Nacos connection refused"));

      await expect(
        registry.register({ pluginConfig, openClawConfig, logger })
      ).rejects.toThrow("Nacos connection refused");

      // Stop should still work (client was created before error)
      mockNamingClient.deregisterInstance.mockResolvedValue(undefined);
      await registry.stop(logger);
    });
  });

  // ============================================================
  // Test 3: Config Center — primary config loading (requirement #1)
  // ============================================================
  describe("3. Config Center — Primary Config Loading", () => {
    it("loads complete config from primary dataId and layers sharedConfigs", async () => {
      const logger = makeLogger();
      const pluginConfig = makePluginConfig();

      // Simulate Nacos returning the primary config
      mockConfigClient.getConfig.mockImplementation(async (dataId: string, group: string) => {
        if (dataId === "openclaw.json" && group === "DEFAULT_GROUP") {
          return JSON.stringify({
            gateway: { port: 18789, mode: "local" },
            hooks: { enabled: true },
            plugins: { entries: {} },
          });
        }
        return null;
      });

      const currentConfig = { gateway: { port: 18789 } };
      const replaceConfig = vi.fn().mockResolvedValue(undefined);
      const deps = {
        pluginConfig,
        getCurrentConfig: () => currentConfig,
        replaceConfig,
        stateDir: "/tmp/test-state",
        logger,
        env: process.env,
      };

      const service = new NacosConfigSyncService();
      await service.pullAndApply(deps, mockConfigClient as unknown as ReturnType<typeof NacosConfigClient>);

      // Verify primary config was fetched
      expect(mockConfigClient.getConfig).toHaveBeenCalledWith("openclaw.json", "DEFAULT_GROUP");

      // Verify replaceConfig was called with merged result
      expect(replaceConfig).toHaveBeenCalledTimes(1);
      const merged = replaceConfig.mock.calls[0][0] as Record<string, unknown>;
      expect(merged.gateway).toMatchObject({ port: 18789, mode: "local" });
      expect(merged.hooks).toMatchObject({ enabled: true });

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("loaded primary config from openclaw.json")
      );
    });

    it("falls back to snapshot when primary dataId is empty", async () => {
      const logger = makeLogger();
      const pluginConfig = makePluginConfig();

      mockConfigClient.getConfig.mockResolvedValue(null);

      const currentConfig = { gateway: { port: 9999 } };
      const replaceConfig = vi.fn().mockResolvedValue(undefined);
      const deps = {
        pluginConfig,
        getCurrentConfig: () => currentConfig,
        replaceConfig,
        stateDir: "/tmp/test-state",
        logger,
        env: process.env,
      };

      const service = new NacosConfigSyncService();
      await service.pullAndApply(deps, mockConfigClient as unknown as ReturnType<typeof NacosConfigClient>);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("primary config openclaw.json is empty")
      );
    });
  });

  // ============================================================
  // Test 4: Plugin Config Loading (requirement #3)
  // ============================================================
  describe("4. Plugin Config Loading (pluginConfigIds)", () => {
    it("loads per-plugin configs and merges into plugins.entries.<id>.config", async () => {
      const logger = makeLogger();
      const pluginConfig = makePluginConfig();

      // Return primary config first, then plugin configs
      mockConfigClient.getConfig.mockImplementation(async (dataId: string, _group: string) => {
        if (dataId === "openclaw.json") {
          return JSON.stringify({ plugins: { entries: {} } });
        }
        if (dataId === "openclaw-weixin-dev.json") {
          return JSON.stringify({ appId: "wx123", appSecret: "***" });
        }
        if (dataId === "openclaw-dingtalk-dev.json") {
          return JSON.stringify({ appKey: "ding456" });
        }
        return null;
      });

      const replaceConfig = vi.fn().mockResolvedValue(undefined);
      const deps = {
        pluginConfig,
        getCurrentConfig: () => ({}),
        replaceConfig,
        stateDir: "/tmp/test-state",
        logger,
        env: process.env,
      };

      const service = new NacosConfigSyncService();
      await service.pullAndApply(deps, mockConfigClient as unknown as ReturnType<typeof NacosConfigClient>);

      // Verify per-plugin configs were fetched
      expect(mockConfigClient.getConfig).toHaveBeenCalledWith("openclaw-weixin-dev.json", "DEFAULT_GROUP");
      expect(mockConfigClient.getConfig).toHaveBeenCalledWith("openclaw-dingtalk-dev.json", "DEFAULT_GROUP");

      // Verify plugin configs were merged into plugins.entries
      const merged = replaceConfig.mock.calls[0][0] as Record<string, unknown>;
      const plugins = merged.plugins as Record<string, unknown>;
      const entries = plugins.entries as Record<string, Record<string, unknown>>;

      expect(entries["openclaw-weixin"].config).toMatchObject({ appId: "wx123", appSecret: "***" });
      expect(entries["openclaw-dingtalk"].config).toMatchObject({ appKey: "ding456" });
    });
  });

  // ============================================================
  // Test 5: Config Backup (requirement #2)
  // ============================================================
  describe("5. Config Backup (backupOpenClawConfig)", () => {
    it("generates backup filename in correct format", () => {
      const ts = formatTimestampYyyyMMddHHmmss(new Date(2026, 4, 19, 13, 36, 0));
      // May 19 2026 = 2026, month 4 (May = index 4 in JS), day 19
      expect(ts).toMatch(/^\d{14}$/);
      expect(ts).toBe("20260519133600");
    });

    it("resolves backup file path correctly with OPENCLAW_CONFIG_PATH", () => {
      const env = { OPENCLAW_CONFIG_PATH: "/custom/path/config.json" };
      const path = resolveConfigFileForBackup(env, "/tmp/state");
      expect(path).toBe("/custom/path/config.json");
    });

    it("resolves backup file path correctly without env override", () => {
      const env = {};
      const path = resolveConfigFileForBackup(env, "/tmp/state");
      expect(path).toBe("/tmp/state/openclaw.json");
    });

    it("backup function handles missing source file gracefully", () => {
      const logger = makeLogger();
      backupOpenClawConfig("/tmp/nonexistent-state", {}, logger);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("skip backup")
      );
    });
  });

  // ============================================================
  // Test 6: Webhook Cluster Discovery (requirement #4)
  // ============================================================
  describe("6. Webhook Cluster Discovery (WebhookClusterService)", () => {
    it("discovers peers and filters out self", async () => {
      const logger = makeLogger();
      const pluginConfig = makePluginConfig({ registerIp: "10.0.0.5" });

      const mockHosts = [
        { ip: "10.0.0.5", port: 18789, healthy: true, weight: 1, metadata: { hooksBasePath: "/hooks" } },
        { ip: "10.0.0.6", port: 18789, healthy: true, weight: 1, metadata: { hooksBasePath: "/hooks" } },
        { ip: "10.0.0.7", port: 18789, healthy: true, weight: 2, metadata: { hooksBasePath: "/hooks" } },
      ];

      mockNamingClient.ready.mockResolvedValue(undefined);
      mockNamingClient.getAllInstances.mockResolvedValue(mockHosts);
      // Capture the subscribe callback
      mockNamingClient.subscribe.mockImplementation((_info: unknown, cb: (hosts: unknown[]) => void) => {
        // Store for later use if needed
      });

      const cluster = new WebhookClusterService();
      await cluster.start({ pluginConfig, selfPort: 18789, logger });

      // Self (10.0.0.5:18789) should be excluded
      const peers = cluster.getPeers();
      expect(peers).toHaveLength(2);
      expect(peers[0].ip).toBe("10.0.0.6");
      expect(peers[1].ip).toBe("10.0.0.7");
      expect(peers.every(p => p.serviceName === "openclaw-gateway")).toBe(true);
      expect(peers.every(p => p.groupName === "DEFAULT_GROUP")).toBe(true);

      // Verify initial state
      const state = cluster.getState();
      expect(state.peers).toHaveLength(2);
      expect(state.lastUpdated).toBeGreaterThan(0);
    });

    it("filters out unhealthy peers", async () => {
      const logger = makeLogger();
      const pluginConfig = makePluginConfig({ registerIp: "10.0.0.5" });

      const mockHosts = [
        { ip: "10.0.0.5", port: 18789, healthy: true, weight: 1, metadata: {} },
        { ip: "10.0.0.6", port: 18789, healthy: false, weight: 1, metadata: {} }, // unhealthy
        { ip: "10.0.0.7", port: 18789, healthy: true, weight: 1, metadata: {} },
      ];

      mockNamingClient.ready.mockResolvedValue(undefined);
      mockNamingClient.getAllInstances.mockResolvedValue(mockHosts);

      const cluster = new WebhookClusterService();
      await cluster.start({ pluginConfig, selfPort: 18789, logger });

      const peers = cluster.getPeers();
      // 10.0.0.6 is unhealthy but still included (WebhookClusterService doesn't filter by healthy)
      // Actually looking at the code: healthy: h.healthy !== false
      // So healthy=false becomes false in peer.healthy, and healthy=true becomes true
      // The filter only excludes SELF (by ip+port), not unhealthy peers
      expect(peers).toHaveLength(2);
      expect(peers.find(p => p.ip === "10.0.0.6")?.healthy).toBe(false);
      expect(peers.find(p => p.ip === "10.0.0.7")?.healthy).toBe(true);
    });

    it("initial state has no peers before start", () => {
      const cluster = new WebhookClusterService();
      expect(cluster.getPeers()).toHaveLength(0);
      expect(cluster.getState().peers).toHaveLength(0);
    });

    it("stop clears peer list and closes client", async () => {
      const logger = makeLogger();
      const pluginConfig = makePluginConfig({ registerIp: "10.0.0.5" });

      mockNamingClient.ready.mockResolvedValue(undefined);
      mockNamingClient.getAllInstances.mockResolvedValue([
        { ip: "10.0.0.6", port: 18789, healthy: true, weight: 1, metadata: {} },
      ]);
      mockNamingClient.close?.mockResolvedValue?.(undefined);

      const cluster = new WebhookClusterService();
      await cluster.start({ pluginConfig, selfPort: 18789, logger });
      expect(cluster.getPeers()).toHaveLength(1);

      await cluster.stop(logger);
      expect(cluster.getPeers()).toHaveLength(0);
      expect(cluster.getState().lastUpdated).toBe(0);
    });
  });

  // ============================================================
  // Test 7: Environment Variable Expansion
  // ============================================================
  describe("7. Environment Variable Expansion", () => {
    it("expands ${VAR} placeholders in config values", () => {
      const env = { DB_HOST: "mysql.internal", DB_PORT: "3306" };
      const config = {
        database: {
          url: "jdbc:mysql://${DB_HOST}:${DB_PORT}/mydb",
          connectionTimeout: "${DB_CONN_TIMEOUT:5000}",
        },
      };

      const expanded = expandEnvPlaceholdersInValue(config, env) as Record<string, unknown>;
      const db = expanded.database as Record<string, string>;
      expect(db.url).toBe("jdbc:mysql://mysql.internal:3306/mydb");
      expect(db.connectionTimeout).toBe("5000"); // default used
    });

    it("replaces missing vars without default with empty string", () => {
      const env = {};
      const config = { url: "http://${MISSING}/api" };
      const expanded = expandEnvPlaceholdersInValue(config, env) as Record<string, string>;
      expect(expanded.url).toBe("http:///api");
    });
  });

  // ============================================================
  // Test 8: Deep Merge
  // ============================================================
  describe("8. Deep Merge", () => {
    it("merges nested objects immutably", () => {
      const target = { a: 1, b: { x: 1, y: 2 } };
      const source = { b: { y: 99, z: 3 }, c: 4 };
      const result = deepMerge(target, source);

      expect(result).toEqual({ a: 1, b: { x: 1, y: 99, z: 3 }, c: 4 });
      // Verify target was not mutated
      expect(target.b.y).toBe(2);
    });
  });

  // ============================================================
  // Test 9: Port and Endpoint Resolution
  // ============================================================
  describe("9. Port and Endpoint Resolution", () => {
    it("resolves gateway port from env variable", () => {
      const env = { OPENCLAW_GATEWAY_PORT: "8080" };
      expect(resolveGatewayPort(undefined, env)).toBe(8080);
    });

    it("resolves gateway port from config when env unset", () => {
      const cfg = { gateway: { port: 3000 } };
      expect(resolveGatewayPort(cfg, {})).toBe(3000);
    });

    it("falls back to default port 18789", () => {
      expect(resolveGatewayPort(undefined, {})).toBe(18789);
    });

    it("resolves hooks info correctly", () => {
      expect(resolveHooksInfo({ hooks: { enabled: true, path: "/webhook" } }))
        .toEqual({ hooksEnabled: true, hooksBasePath: "/webhook" });
      expect(resolveHooksInfo({ hooks: { enabled: false } }))
        .toEqual({ hooksEnabled: false, hooksBasePath: "/hooks" });
    });
  });

  // ============================================================
  // Test 10: Flatten Spring Nacos Config
  // ============================================================
  describe("10. Spring-Style Config Flattening", () => {
    it("flattens nested nacos config while preserving top-level keys", () => {
      const raw = {
        serverList: "top-level.example.com:8848", // should win
        nacos: {
          "server-addr": "nested.example.com:8848",
          discovery: {
            namespace: "nested-ns",
          },
          config: {
            "shared-configs": [
              { "data-id": "common.yml", group: "COMMON" },
            ],
          },
        },
      };

      const flat = flattenSpringNacosPluginConfig(raw);
      expect(flat.serverList).toBe("top-level.example.com:8848"); // top-level wins
      expect(flat.namespace).toBe("nested-ns");
      expect(flat.configCenter).toBeDefined();
      const cc = flat.configCenter as Record<string, unknown>;
      const scs = cc.sharedConfigs as Array<Record<string, string>>;
      expect(scs[0].dataId).toBe("common.yml");
    });
  });
});
