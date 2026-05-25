import { describe, expect, it } from "vitest";

import { DEFAULT_WEBSOCKET_CONFIG } from "../src/config.js";
import { resolveInboundRoute } from "../src/routing/agent-router.js";

describe("resolveInboundRoute", () => {
  it("matches connectionId binding", () => {
    const config = {
      ...DEFAULT_WEBSOCKET_CONFIG,
      agentBindings: [{ connectionId: "abc", agentId: "agent-a" }],
    };
    const route = resolveInboundRoute("abc", config);
    expect(route?.agentId).toBe("agent-a");
    expect(route?.source).toBe("binding");
  });

  it("falls back to defaultAgentId", () => {
    const config = {
      ...DEFAULT_WEBSOCKET_CONFIG,
      defaultAgentId: "default-a",
    };
    const route = resolveInboundRoute("any-id", config);
    expect(route?.agentId).toBe("default-a");
    expect(route?.source).toBe("default");
  });

  it("returns null when no route", () => {
    expect(resolveInboundRoute("x", DEFAULT_WEBSOCKET_CONFIG)).toBeNull();
  });
});
