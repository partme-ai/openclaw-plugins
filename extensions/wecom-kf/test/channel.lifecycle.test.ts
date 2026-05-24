import {
  type ChannelAccountSnapshot,
  type ChannelGatewayContext,
  type OpenClawConfig,
} from "openclaw/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import { createRuntimeEnv } from "../../../test-utils/runtime-env.js";
import { wecomPlugin } from "../src/channel/channel.js";
import type { ResolvedWecomAccount } from "../src/types/index.js";

function createCtx(params: {
  cfg: OpenClawConfig;
  accountId?: string;
  abortController: AbortController;
}): ChannelGatewayContext<ResolvedWecomAccount> & {
  statusUpdates: Array<Partial<ChannelAccountSnapshot>>;
} {
  const accountId = params.accountId ?? "default";
  const account = wecomPlugin.config.resolveAccount(
    params.cfg,
    accountId,
  ) as ResolvedWecomAccount;
  const snapshot: ChannelAccountSnapshot = {
    accountId,
    configured: true,
    enabled: true,
    running: false,
  };
  const statusUpdates: Array<Partial<ChannelAccountSnapshot>> = [];
  return {
    cfg: params.cfg,
    accountId,
    account,
    runtime: createRuntimeEnv(),
    abortSignal: params.abortController.signal,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    getStatus: () => snapshot,
    setStatus: (next) => {
      statusUpdates.push(next);
      Object.assign(snapshot, next);
    },
    statusUpdates,
  };
}

function createKfConfig(): OpenClawConfig {
  return {
    channels: {
      "wecom-kf": {
        enabled: true,
        corpId: "corp",
        token: "token",
        encodingAESKey: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
        openKfId: "wk123",
        corpSecret: "secret",
      },
    },
  } as OpenClawConfig;
}

describe("wecomPlugin gateway lifecycle", () => {
  it("keeps startAccount pending until abort signal in KF-only mode", async () => {
    const cfg = createKfConfig();
    const abortController = new AbortController();
    const ctx = createCtx({ cfg, abortController });

    const startPromise = wecomPlugin.gateway!.startAccount!(ctx);
    let resolved = false;
    void startPromise.then(() => {
      resolved = true;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(resolved).toBe(false);
    expect(ctx.getStatus().running).toBe(true);
    expect(ctx.getStatus().webhookPath).toBe("/wecom-kf");

    abortController.abort();
    await startPromise;
    expect(resolved).toBe(true);
    expect(ctx.getStatus().running).toBe(false);
  });

  it("warns when bot/agent config remains but runs KF-only", async () => {
    const cfg = {
      channels: {
        "wecom-kf": {
          enabled: true,
          corpId: "corp",
          token: "token",
          encodingAESKey: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
          bot: {
            token: "bot-token",
            encodingAESKey: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
          },
        },
      },
    } as OpenClawConfig;
    const abortController = new AbortController();
    const ctx = createCtx({ cfg, abortController });

    const startPromise = wecomPlugin.gateway!.startAccount!(ctx);
    await Promise.resolve();
    expect(ctx.log.warn).toHaveBeenCalledWith(
      expect.stringContaining("Legacy wecom-cs 路径已移除"),
    );

    abortController.abort();
    await startPromise;
  });

  it("rejects startup when matrix account credentials conflict", async () => {
    const cfg = {
      channels: {
        "wecom-kf": {
          enabled: true,
          accounts: {
            "acct-a": {
              enabled: true,
              bot: {
                token: "token-shared",
                encodingAESKey: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
              },
            },
            "acct-b": {
              enabled: true,
              bot: {
                token: "token-shared",
                encodingAESKey: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
              },
            },
          },
        },
      },
    } as OpenClawConfig;
    const abortController = new AbortController();
    const ctx = createCtx({ cfg, accountId: "acct-b", abortController });

    await expect(wecomPlugin.gateway!.startAccount!(ctx)).rejects.toThrow(
      /Duplicate WeCom bot token/i,
    );
  });
});
