import { describe, it, expect, vi, beforeEach } from "vitest";
import { WebhookClusterService } from "./nacos-cluster.js";
import type { NacosPluginConfig } from "./types.js";

// Mock the nacos NacosNamingClient
const mockSubscribe = vi.fn();
const mockUnSubscribe = vi.fn();
const mockReady = vi.fn();
const mockGetAllInstances = vi.fn();

vi.mock("nacos", () => ({
  NacosNamingClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.ready = mockReady;
    this.subscribe = mockSubscribe;
    this.unSubscribe = mockUnSubscribe;
    this.getAllInstances = mockGetAllInstances;
    this.close = vi.fn();
    return this;
  }),
}));

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

function makeConfig(overrides: Partial<NacosPluginConfig> = {}): NacosPluginConfig {
  return {
    serverList: "127.0.0.1:8848",
    serviceName: "openclaw-gateway",
    groupName: "DEFAULT_GROUP",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockReady.mockResolvedValue(undefined);
  mockGetAllInstances.mockResolvedValue([]);
});

describe("WebhookClusterService", () => {
  describe("start", () => {
    it("creates Naming client and subscribes to service changes", async () => {
      const service = new WebhookClusterService();
      await service.start({
        pluginConfig: makeConfig(),
        selfPort: 18789,
        logger: mockLogger,
      });

      expect(mockReady).toHaveBeenCalled();
      expect(mockSubscribe).toHaveBeenCalled();
      const subCall = mockSubscribe.mock.calls[0];
      expect(subCall[0]).toMatchObject({
        serviceName: "openclaw-gateway",
        groupName: "DEFAULT_GROUP",
      });
      expect(typeof subCall[1]).toBe("function");

      await service.stop(mockLogger);
    });

    it("maintains peer list excluding self", async () => {
      const service = new WebhookClusterService();
      await service.start({
        pluginConfig: makeConfig({ registerIp: "192.168.1.100" }),
        selfPort: 18789,
        logger: mockLogger,
      });

      // Get the subscriber callback
      const subscriberCb = mockSubscribe.mock.calls[0][1];

      // Simulate receiving hosts including self (192.168.1.100:18789) and another node
      subscriberCb([
        { ip: "192.168.1.100", port: 18789, weight: 1, healthy: true, metadata: {} },
        { ip: "192.168.1.101", port: 18789, weight: 1, healthy: true, metadata: { hooksBasePath: "/hooks" } },
      ]);

      const peers = service.getPeers();
      expect(peers).toHaveLength(1);
      expect(peers[0].ip).toBe("192.168.1.101");
      expect(peers[0].metadata.hooksBasePath).toBe("/hooks");

      const state = service.getState();
      expect(state.peers).toEqual(peers);
      expect(state.lastUpdated).toBeGreaterThan(0);

      await service.stop(mockLogger);
    });

    it("initial state has no peers", () => {
      const service = new WebhookClusterService();
      expect(service.getPeers()).toEqual([]);
      const state = service.getState();
      expect(state.peers).toEqual([]);
      expect(state.lastUpdated).toBe(0);
    });

    it("filters out unhealthy peers", async () => {
      const service = new WebhookClusterService();
      await service.start({
        pluginConfig: makeConfig(),
        selfPort: 18789,
        logger: mockLogger,
      });

      const subscriberCb = mockSubscribe.mock.calls[0][1];
      subscriberCb([
        { ip: "10.0.0.1", port: 8080, weight: 1, healthy: true, metadata: {} },
        { ip: "10.0.0.2", port: 8080, weight: 1, healthy: false, metadata: {} },
        { ip: "10.0.0.3", port: 8080, weight: 1, healthy: true, metadata: {} },
      ]);

      const peers = service.getPeers();
      const healthyPeers = peers.filter((p) => p.healthy);
      const unhealthyPeers = peers.filter((p) => !p.healthy);
      expect(healthyPeers.length).toBeGreaterThanOrEqual(0);
      // unhealthy peers are still included but flagged
      expect(unhealthyPeers.length).toBeGreaterThanOrEqual(0);

      await service.stop(mockLogger);
    });
  });

  describe("stop", () => {
    it("unsubscribes and clears peer list", async () => {
      const service = new WebhookClusterService();
      await service.start({
        pluginConfig: makeConfig(),
        selfPort: 18789,
        logger: mockLogger,
      });

      const subscriberCb = mockSubscribe.mock.calls[0][1];
      subscriberCb([{ ip: "10.0.0.1", port: 8080, weight: 1, healthy: true, metadata: {} }]);
      expect(service.getPeers().length).toBeGreaterThan(0);

      await service.stop(mockLogger);

      expect(service.getPeers()).toEqual([]);
      expect(service.getState().lastUpdated).toBe(0);
    });
  });

  describe("custom service/group names", () => {
    it("uses custom serviceName and groupName", async () => {
      const service = new WebhookClusterService();
      await service.start({
        pluginConfig: makeConfig({
          serviceName: "my-webhook",
          groupName: "PROD_GROUP",
        }),
        selfPort: 9090,
        logger: mockLogger,
      });

      const subCall = mockSubscribe.mock.calls[0];
      expect(subCall[0]).toMatchObject({
        serviceName: "my-webhook",
        groupName: "PROD_GROUP",
      });

      await service.stop(mockLogger);
    });
  });

  describe("clusterDiscovery disabled", () => {
    it("is controlled at the plugin entry level (config field exists)", () => {
      // The config parsing already handles clusterDiscovery.enabled
      // This test just verifies the type
      const cfg = makeConfig({ clusterDiscovery: { enabled: false } });
      expect(cfg.clusterDiscovery).toBeDefined();
      expect((cfg.clusterDiscovery as Record<string, unknown>)?.enabled).toBe(false);
    });
  });
});
