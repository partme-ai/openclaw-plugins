/** 抖音自定义 Webhook 必须显式执行的 DM 与命令授权测试。 */
import { describe, expect, it, vi } from "vitest";
import type { PluginRuntime } from "openclaw/plugin-sdk/core";

import { authorizeDouyinInbound } from "../src/dispatch/access-policy.js";
import type { ResolvedDouyinAccount } from "../src/types.js";

function account(config: ResolvedDouyinAccount["config"]): ResolvedDouyinAccount {
  return {
    accountId: "default",
    enabled: true,
    configured: true,
    app_key: "key",
    app_secret: "secret",
    webhook_path: "/channels/douyin/webhook",
    config,
  };
}

function runtime(paired: string[] = []): PluginRuntime {
  return {
    channel: {
      pairing: {
        readAllowFromStore: vi.fn(async () => paired),
        upsertPairingRequest: vi.fn(async () => ({ code: "PAIR01", created: true })),
      },
      commands: {
        shouldComputeCommandAuthorized: vi.fn((text: string) => text.startsWith("/")),
        resolveCommandAuthorizedFromAuthorizers: vi.fn(({ authorizers }) =>
          authorizers.every((entry: { allowed: boolean }) => entry.allowed),
        ),
      },
    },
  } as unknown as PluginRuntime;
}

describe("authorizeDouyinInbound", () => {
  it("blocks disabled accounts before Agent dispatch", async () => {
    const result = await authorizeDouyinInbound({
      runtime: runtime(),
      cfg: {},
      account: account({ dmPolicy: "disabled" }),
      peerId: "user-a",
      rawText: "普通事件",
    });
    expect(result).toEqual({ allowed: false, commandAuthorized: false });
  });

  it("enforces allowFrom instead of trusting the signed callback sender", async () => {
    const denied = await authorizeDouyinInbound({
      runtime: runtime(),
      cfg: {},
      account: account({ dmPolicy: "allowlist", allowFrom: ["user-b"] }),
      peerId: "user-a",
      rawText: "普通事件",
    });
    const allowed = await authorizeDouyinInbound({
      runtime: runtime(),
      cfg: {},
      account: account({ dmPolicy: "allowlist", allowFrom: ["douyin:user-a"] }),
      peerId: "user-a",
      rawText: "普通事件",
    });
    expect(denied.allowed).toBe(false);
    expect(allowed.allowed).toBe(true);
  });

  it("creates a pairing request without exposing its code in webhook output", async () => {
    const rt = runtime();
    const result = await authorizeDouyinInbound({
      runtime: rt,
      cfg: {},
      account: account({ dmPolicy: "pairing" }),
      peerId: "new-user",
      rawText: "普通事件",
    });
    expect(result.allowed).toBe(false);
    expect(rt.channel.pairing.upsertPairingRequest).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "douyin", id: "new-user", accountId: "default" }),
    );
  });

  it("marks unauthorized slash commands as blocked", async () => {
    const result = await authorizeDouyinInbound({
      runtime: runtime(),
      cfg: {},
      account: account({ dmPolicy: "allowlist", allowFrom: ["other-user"] }),
      peerId: "user-a",
      rawText: "/status",
    });
    expect(result).toEqual({ allowed: false, commandAuthorized: false });
  });
});
