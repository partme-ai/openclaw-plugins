import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { describe, expect, it } from "vitest";

import { resolveWecomAccount } from "./accounts.js";

describe("resolveWecomAccount", () => {
  const cfg: OpenClawConfig = {
    channels: {
      "wecom-kf": {
        enabled: true,
        defaultAccount: "acct-a",
        corpId: "ww123",
        corpSecret: "secret",
        token: "token-a",
        encodingAESKey: "aes-a",
        openKfId: "kf_a",
        agentId: "agent-a",
        accounts: {
          "acct-a": {
            enabled: true,
            openKfId: "kf_a",
            agentId: "agent-a",
            token: "token-a",
            encodingAESKey: "aes-a",
          },
        },
      },
    },
  } as OpenClawConfig;

  it("does not fall back when explicit accountId does not exist", () => {
    const account = resolveWecomAccount({ cfg, accountId: "missing" });
    expect(account.accountId).toBe("missing");
    expect(account.enabled).toBe(false);
    expect(account.configured).toBe(false);
  });

  it("uses configured default account when accountId is omitted", () => {
    const account = resolveWecomAccount({ cfg });
    expect(account.accountId).toBe("acct-a");
    expect(account.enabled).toBe(true);
    expect(account.configured).toBe(true);
  });
});
