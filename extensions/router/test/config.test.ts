import { describe, expect, it } from "vitest";

import { resolveRouterConfig } from "../src/config.js";

function api(pluginConfig: Record<string, unknown>) {
  return { pluginConfig } as never;
}

describe("resolveRouterConfig", () => {
  it("applies production-safe bounded delivery defaults", () => {
    expect(resolveRouterConfig(api({}))).toMatchObject({
      enabled: true,
      rules: [],
      audit: { enabled: true, logToConsole: false, maxEntries: 5_000 },
      delivery: {
        statePreviousEncryptionKeyEnvs: [],
        maxAttempts: 5,
        initialDelayMs: 500,
        maxDelayMs: 30_000,
        dedupeTtlMs: 86_400_000,
        maxHops: 8,
      },
    });
  });

  it("rejects duplicate rule ids", () => {
    expect(() => resolveRouterConfig(api({
      rules: [
        { id: "duplicate", actions: [{ type: "forward", target: "mqtt" }] },
        { id: "duplicate", actions: [{ type: "forward", target: "rabbitmq" }] },
      ],
    }))).toThrow(/duplicate rule id/);
  });

  it("rejects empty actions and malformed targets", () => {
    expect(() => resolveRouterConfig(api({ rules: [{ id: "empty", actions: [] }] })))
      .toThrow(/at least one action/);
    expect(() => resolveRouterConfig(api({
      rules: [{ id: "invalid", actions: [{ type: "forward", target: " " }] }],
    }))).toThrow(/target must be a non-empty string/);
  });

  it("normalizes whitespace and accepts wildcard patterns", () => {
    const resolved = resolveRouterConfig(api({
      rules: [{
        id: " route ",
        match: { channels: [" web-* "], topic: " alerts/** " },
        actions: [{ type: "reply-via", target: " wecom ", accountId: " ops " }],
      }],
    }));
    expect(resolved.rules[0]).toEqual({
      id: "route",
      match: { channels: ["web-*"], topic: "alerts/**" },
      actions: [{ type: "reply-via", target: "wecom", accountId: "ops" }],
    });
  });

  it("rejects unknown fields, invalid explicit types, and unsafe retry ranges", () => {
    expect(() => resolveRouterConfig(api({ delivery: { publishTimoutMs: 1000 } })))
      .toThrow(/unknown field.*publishTimoutMs/);
    expect(() => resolveRouterConfig(api({ rules: "not-an-array" })))
      .toThrow(/rules must be an array/);
    expect(() => resolveRouterConfig(api({ enabled: "yes" })))
      .toThrow(/enabled must be a boolean/);
    expect(() => resolveRouterConfig(api({ delivery: { maxAttempts: -1 } })))
      .toThrow(/maxAttempts must be a finite number/);
    expect(() => resolveRouterConfig(api({
      delivery: { initialDelayMs: 1000, maxDelayMs: 100 },
    }))).toThrow(/maxDelayMs must be greater than or equal/);
  });

  it("rejects misspelled rule and action fields", () => {
    expect(() => resolveRouterConfig(api({
      rules: [{ id: "r", matc: {}, actions: [{ type: "forward", target: "mqtt" }] }],
    }))).toThrow(/unknown field.*matc/);
    expect(() => resolveRouterConfig(api({
      rules: [{ id: "r", actions: [{ type: "forward", target: "mqtt", topc: "events" }] }],
    }))).toThrow(/unknown field.*topc/);
  });

  it("validates state encryption key environment references and rotation order", () => {
    expect(resolveRouterConfig(api({
      delivery: {
        stateEncryptionKeyEnv: "ROUTER_STATE_KEY",
        statePreviousEncryptionKeyEnvs: ["ROUTER_STATE_KEY_OLD"],
      },
    })).delivery).toMatchObject({
      stateEncryptionKeyEnv: "ROUTER_STATE_KEY",
      statePreviousEncryptionKeyEnvs: ["ROUTER_STATE_KEY_OLD"],
    });
    expect(() => resolveRouterConfig(api({
      delivery: { stateEncryptionKeyEnv: "not-valid" },
    }))).toThrow("environment variable name");
    expect(() => resolveRouterConfig(api({
      delivery: {
        stateEncryptionKeyEnv: "ROUTER_STATE_KEY",
        statePreviousEncryptionKeyEnvs: ["ROUTER_STATE_KEY"],
      },
    }))).toThrow("must not also be a previous key");
    expect(() => resolveRouterConfig(api({
      delivery: {
        statePreviousEncryptionKeyEnvs: ["OLD_KEY", "OLD_KEY"],
      },
    }))).toThrow("must not contain duplicates");
  });
});
