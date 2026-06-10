/**
 * dm-scope 模块测试。
 * 与 openclaw-redis-stream / openclaw-gotify 的测试模式完全一致。
 */
import { describe, it, expect } from "vitest";
import { resolveDmScopeFromRuntimeConfig, buildSessionKeyFromDmScope } from "../src/shared/dm-scope.js";

describe("resolveDmScopeFromRuntimeConfig", () => {
  it("returns per-peer when no session config present (default)", () => {
    expect(resolveDmScopeFromRuntimeConfig({})).toBe("per-peer");
  });

  it("returns per-peer when session.dmScope is missing", () => {
    expect(resolveDmScopeFromRuntimeConfig({ session: {} })).toBe("per-peer");
  });

  it("returns per-peer for invalid value", () => {
    expect(resolveDmScopeFromRuntimeConfig({ session: { dmScope: "invalid" } })).toBe("per-peer");
  });

  it("returns per-peer for empty string", () => {
    expect(resolveDmScopeFromRuntimeConfig({ session: { dmScope: "" } })).toBe("per-peer");
  });

  it("returns main when explicitly configured", () => {
    expect(resolveDmScopeFromRuntimeConfig({ session: { dmScope: "main" } })).toBe("main");
  });

  it("returns per-peer when configured", () => {
    expect(resolveDmScopeFromRuntimeConfig({ session: { dmScope: "per-peer" } })).toBe("per-peer");
  });

  it("returns per-channel-peer when configured", () => {
    const cfg = { session: { dmScope: "per-channel-peer" as const } };
    expect(resolveDmScopeFromRuntimeConfig(cfg)).toBe("per-channel-peer");
  });

  it("returns per-account-channel-peer when configured", () => {
    const cfg = { session: { dmScope: "per-account-channel-peer" as const } };
    expect(resolveDmScopeFromRuntimeConfig(cfg)).toBe("per-account-channel-peer");
  });

  it("returns per-peer for non-string dmScope", () => {
    expect(resolveDmScopeFromRuntimeConfig({ session: { dmScope: 123 } })).toBe("per-peer");
  });
});

describe("buildSessionKeyFromDmScope", () => {
  const baseParams = {
    cfg: {} as Record<string, unknown>,
    agentId: "test-agent",
    channel: "rabbitmq",
    accountId: "default",
    peerId: "peer-001",
  };

  it("returns main-scoped key when dmScope is main", () => {
    const key = buildSessionKeyFromDmScope({
      ...baseParams,
      cfg: { session: { dmScope: "main" } },
    });
    expect(key).toBe("agent:test-agent:main");
  });

  it("returns per-peer scoped key", () => {
    const key = buildSessionKeyFromDmScope({
      ...baseParams,
      cfg: { session: { dmScope: "per-peer" } },
    });
    expect(key).toBe("agent:test-agent:direct:peer-001");
  });

  it("returns per-channel-peer scoped key", () => {
    const key = buildSessionKeyFromDmScope({
      ...baseParams,
      cfg: { session: { dmScope: "per-channel-peer" } },
    });
    expect(key).toBe("agent:test-agent:rabbitmq:direct:peer-001");
  });

  it("returns per-account-channel-peer scoped key", () => {
    const key = buildSessionKeyFromDmScope({
      ...baseParams,
      cfg: { session: { dmScope: "per-account-channel-peer" } },
    });
    expect(key).toBe("agent:test-agent:rabbitmq:default:direct:peer-001");
  });

  it("falls back to main when peerId is empty", () => {
    const key = buildSessionKeyFromDmScope({
      ...baseParams,
      peerId: "",
      cfg: { session: { dmScope: "per-peer" } },
    });
    expect(key).toBe("agent:test-agent:main");
  });

  it("normalizes tokens (trim + lowercase)", () => {
    const key = buildSessionKeyFromDmScope({
      ...baseParams,
      agentId: "  TEST-AGENT  ",
      channel: "  RABBITMQ  ",
      accountId: "  DEFAULT  ",
      peerId: "  PEER-001  ",
      cfg: { session: { dmScope: "per-channel-peer" } },
    });
    expect(key).toBe("agent:test-agent:rabbitmq:direct:peer-001");
  });

  it("defaults when agentId normalizes to empty", () => {
    const key = buildSessionKeyFromDmScope({
      ...baseParams,
      agentId: "   ",
      cfg: { session: { dmScope: "per-peer" } },
    });
    expect(key).toBe("agent:main:direct:peer-001");
  });
});
