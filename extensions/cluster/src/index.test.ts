/**
 * Cluster plugin registration smoke tests.
 */
import { describe, expect, it, vi } from "vitest";

import {
  createManifestSmokeTests,
  pluginRootFromTestFile,
} from "../../../test-utils/plugin-manifest.js";
import register from "./index.js";

createManifestSmokeTests(pluginRootFromTestFile(import.meta.url), {
  expectedId: "cluster",
});

vi.mock("./discovery/discovery.js", () => ({
  createDiscoveryService: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    getNodes: vi.fn(() => []),
    onNodeChange: vi.fn(),
  })),
}));

vi.mock("./config-sync/config-sync.js", () => ({
  createConfigSyncService: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    pushConfig: vi.fn(),
    onConfigChange: vi.fn(),
  })),
}));

vi.mock("./session-store/session-store.js", () => ({
  createSessionStoreService: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
  })),
}));

vi.mock("./proxy/proxy.js", () => ({
  createProxyService: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
  })),
}));

describe("cluster plugin register", () => {
  it("registers four HTTP cluster routes", () => {
    const routes: Array<{ path: string }> = [];
    const api = {
      runtime: { config: { cluster: { nodeId: "test-node" } } },
      registerHttpRoute: vi.fn((route: { path: string }) => {
        routes.push(route);
      }),
      registerService: vi.fn(({ start }: { start: () => Promise<void> }) => {
        void start();
      }),
    };

    register(api as never);

    expect(routes.map((r) => r.path).sort()).toEqual([
      "/cluster/config",
      "/cluster/nodes",
      "/cluster/sessions",
      "/cluster/status",
    ]);
  });
});
