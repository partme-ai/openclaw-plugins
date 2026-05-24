/**
 * HttpProxyServer routing table and forward error paths.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HttpProxyServer } from "./http-proxy.js";
import type { ClusterNodeInfo } from "../shared/types.js";

describe("HttpProxyServer", () => {
  let proxy: HttpProxyServer;

  beforeEach(() => {
    proxy = new HttpProxyServer({ port: 0, protocol: "http", timeout: 1000 });
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(async () => {
    await proxy.stop();
    vi.unstubAllGlobals();
  });

  it("updateNodes indexes nodes by nodeId", async () => {
    const nodes: ClusterNodeInfo[] = [
      {
        nodeId: "n1",
        address: "10.0.0.2",
        port: 18789,
        status: "online",
        lastHeartbeat: new Date().toISOString(),
        activeSessions: 0,
        activeConnections: 0,
        joinedAt: new Date().toISOString(),
      },
    ];
    proxy.updateNodes(nodes);

    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, text: async () => "" } as Response);
    await proxy.forwardMessage("n1", "sess-1", "hello");

    expect(fetch).toHaveBeenCalledOnce();
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe("http://10.0.0.2:18789/forward");
  });

  it("forwardMessage throws for unknown node", async () => {
    await expect(proxy.forwardMessage("missing", "sess", "msg")).rejects.toThrow(
      /Unknown target node/,
    );
  });

  it("forwardMessage throws when remote responds non-ok", async () => {
    proxy.updateNodes([
      {
        nodeId: "n2",
        address: "127.0.0.1",
        port: 18789,
        status: "online",
        lastHeartbeat: new Date().toISOString(),
        activeSessions: 0,
        activeConnections: 0,
        joinedAt: new Date().toISOString(),
      },
    ]);

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => "down",
    } as Response);

    await expect(proxy.forwardMessage("n2", "sess", "msg")).rejects.toThrow(/503/);
  });
});
