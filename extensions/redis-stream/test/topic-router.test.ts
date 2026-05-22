/**
 * topic-router 测试。
 */
import { describe, it, expect } from "vitest";
import {
  matchChannel,
  resolveInboundRoute,
  buildReplyChannelFromInbound,
  buildOutboundChannel,
  loadChannelBindings,
} from "../src/routing/topic-router.js";
import type { RedisChannelBinding } from "../src/types.js";

describe("matchChannel", () => {
  it("matches exact channel names", () => {
    expect(matchChannel("openclaw:agent:test:in", "openclaw:agent:test:in")).toBe(true);
  });

  it("rejects different channel names", () => {
    expect(matchChannel("openclaw:agent:test:in", "openclaw:agent:other:in")).toBe(false);
  });

  it("rejects shorter channel than pattern", () => {
    expect(matchChannel("openclaw:agent", "openclaw:agent:test:in")).toBe(false);
  });

  it("matches * wildcard at pattern end", () => {
    expect(matchChannel("openclaw:agent:test:in", "openclaw:agent:*")).toBe(true);
  });

  it("matches * wildcard matching all remaining", () => {
    expect(matchChannel("a:b:c:d", "a:*")).toBe(true);
  });

  it("matches standalone *", () => {
    expect(matchChannel("any:channel:name", "*")).toBe(true);
  });

  it("matches exact segments then *", () => {
    expect(matchChannel("sensor:temperature:bedroom", "sensor:temperature:*")).toBe(true);
  });

  it("rejects when * is not at the end but segment mismatch before", () => {
    expect(matchChannel("other:temperature", "sensor:*")).toBe(false);
  });

  it("rejects when channel shorter than exact pattern parts", () => {
    expect(matchChannel("sensor", "sensor:temperature")).toBe(false);
  });
});

describe("resolveInboundRoute", () => {
  const bindings: RedisChannelBinding[] = [
    {
      channelPattern: "sensor:temperature",
      agentId: "iot-agent",
      accountId: "default",
      replyChannel: "sensor:temperature:resp",
    },
    {
      channelPattern: "chat:*",
      agentId: "chat-agent",
      accountId: "chat-account",
    },
  ];

  it("matches explicit binding first", () => {
    const route = resolveInboundRoute("sensor:temperature", bindings);
    expect(route).not.toBeNull();
    expect(route!.agentId).toBe("iot-agent");
    expect(route!.accountId).toBe("default");
    expect(route!.replyChannel).toBe("sensor:temperature:resp");
    expect(route!.source).toBe("binding");
  });

  it("matches wildcard binding", () => {
    const route = resolveInboundRoute("chat:general", bindings);
    expect(route).not.toBeNull();
    expect(route!.agentId).toBe("chat-agent");
    expect(route!.accountId).toBe("chat-account");
    expect(route!.source).toBe("binding");
  });

  it("falls back to standard format", () => {
    const route = resolveInboundRoute("openclaw:agent:bot1:in");
    expect(route).not.toBeNull();
    expect(route!.agentId).toBe("bot1");
    expect(route!.accountId).toBe("default");
    expect(route!.source).toBe("standard");
  });

  it("returns null for unmatched channel", () => {
    expect(resolveInboundRoute("unknown:channel")).toBeNull();
  });

  it("returns null for standard-like but with extra segments", () => {
    expect(resolveInboundRoute("openclaw:agent:bot1:in:extra")).toBeNull();
  });

  it("binding priority over standard", () => {
    // Create a binding that matches a standard-looking channel
    const overrideBindings: RedisChannelBinding[] = [
      {
        channelPattern: "openclaw:agent:bot1:in",
        agentId: "custom-agent",
        accountId: "custom-account",
      },
    ];
    const route = resolveInboundRoute("openclaw:agent:bot1:in", overrideBindings);
    expect(route).not.toBeNull();
    expect(route!.agentId).toBe("custom-agent");
    expect(route!.source).toBe("binding");
  });
});

describe("buildReplyChannelFromInbound", () => {
  it("replaces :in with :out", () => {
    expect(buildReplyChannelFromInbound("openclaw:agent:bot1:in")).toBe("openclaw:agent:bot1:out");
  });

  it("appends :out when no :in suffix", () => {
    expect(buildReplyChannelFromInbound("sensor:temperature")).toBe("sensor:temperature:out");
  });
});

describe("buildOutboundChannel", () => {
  it("builds standard outbound channel", () => {
    expect(buildOutboundChannel("my-agent")).toBe("openclaw:agent:my-agent:out");
  });
});

describe("loadChannelBindings", () => {
  it("stores bindings for later use", () => {
    loadChannelBindings([{ channelPattern: "test:*", agentId: "test-agent" }]);
    // The function should not throw
  });
});
