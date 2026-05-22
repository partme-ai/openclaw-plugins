import { describe, expect, it, vi } from "vitest";
import {
  resolveChannelAgentRoute,
  resolveChannelDispatchIdentity,
} from "./resolve-channel-route.js";
import type { BridgePluginRuntime } from "./types.js";

function mockRuntime(route: Record<string, unknown>): BridgePluginRuntime {
  return {
    config: { channels: {} },
    channel: {
      routing: {
        resolveAgentRoute: vi.fn().mockResolvedValue(route),
      },
      reply: {} as never,
    },
  };
}

describe("resolveChannelAgentRoute", () => {
  it("delegates to runtime.channel.routing.resolveAgentRoute", async () => {
    const runtime = mockRuntime({ sessionKey: "agent:main:direct:p1", agentId: "main" });
    const result = await resolveChannelAgentRoute(runtime, {
      channel: "mqtt",
      accountId: "default",
      peerId: "p1",
    });
    expect(runtime.channel.routing.resolveAgentRoute).toHaveBeenCalledWith({
      cfg: runtime.config,
      channel: "mqtt",
      accountId: "default",
      peer: { kind: "direct", id: "p1" },
    });
    expect(result.sessionKey).toBe("agent:main:direct:p1");
  });
});

describe("resolveChannelDispatchIdentity", () => {
  it("uses explicit sessionKey when provided", async () => {
    const runtime = mockRuntime({ sessionKey: "from-route", agentId: "a1" });
    const result = await resolveChannelDispatchIdentity(runtime, {
      channel: "stomp-tcp",
      accountId: "default",
      peerId: "peer",
      sessionKey: "explicit-sk",
      agentId: "main",
    });
    expect(result.sessionKey).toBe("explicit-sk");
    expect(result.agentId).toBe("main");
  });

  it("falls back to route sessionKey and agentId", async () => {
    const runtime = mockRuntime({ sessionKey: "agent:main:direct:x", agentId: "worker" });
    const result = await resolveChannelDispatchIdentity(runtime, {
      channel: "rabbitmq",
      accountId: "acc",
      peerId: "x",
    });
    expect(result.sessionKey).toBe("agent:main:direct:x");
    expect(result.agentId).toBe("worker");
  });

  it("throws when sessionKey cannot be resolved", async () => {
    const runtime = mockRuntime({ agentId: "main" });
    await expect(
      resolveChannelDispatchIdentity(runtime, {
        channel: "mqtt",
        accountId: "default",
        peerId: "p",
      }),
    ).rejects.toThrow(/empty sessionKey/);
  });
});
