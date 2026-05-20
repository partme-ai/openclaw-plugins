/**
 * Unit Tests for DingTalk Config Schema and Account Helpers
 *
 * Ported from reference dingtalk plugin config.test.ts with adaptations
 * for the OpenClaw SDK plugin architecture.
 */

import { describe, it, expect } from "vitest";
import { DingTalkConfigSchema, DingTalkAccountConfigSchema } from "./types.js";
import {
  listDingTalkAccountIds,
  resolveDefaultDingTalkAccountId,
  resolveDingTalkAccount,
} from "./accounts.js";
import type { OpenClawConfig } from "openclaw/plugin-sdk/core";

// ======================= Config Schema Validation =======================

describe("DingTalkConfigSchema", () => {
  it("should parse a minimal valid config and apply defaults", () => {
    const result = DingTalkConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("clientId");
      expect(result.data).not.toHaveProperty("clientSecret");
    }
  });

  it("should parse a fully populated config", () => {
    const result = DingTalkConfigSchema.safeParse({
      enabled: true,
      clientId: "app-key-123",
      clientSecret: "app-secret-456",
      name: "My Bot",
      allowFrom: ["user1", "user2"],
      groupPolicy: "allowlist",
      groupAllowFrom: ["conv1"],
      defaultAccount: "main",
      accounts: {
        main: {
          clientId: "main-key",
          clientSecret: "main-secret",
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("should reject invalid groupPolicy values", () => {
    const result = DingTalkConfigSchema.safeParse({
      groupPolicy: "invalid",
    });
    expect(result.success).toBe(false);
  });

  it("should accept all valid groupPolicy values", () => {
    for (const policy of ["open", "allowlist", "disabled"] as const) {
      const result = DingTalkConfigSchema.safeParse({ groupPolicy: policy });
      expect(result.success).toBe(true);
    }
  });

  it("should parse account-level config with overrides", () => {
    const result = DingTalkConfigSchema.safeParse({
      enabled: true,
      clientId: "base-key",
      clientSecret: "base-secret",
      allowFrom: ["*"],
      groupPolicy: "open",
      accounts: {
        bot1: {
          enabled: true,
          clientId: "bot1-key",
          clientSecret: "bot1-secret",
          name: "Bot One",
          allowFrom: ["u1"],
          groupPolicy: "allowlist",
        },
        bot2: {
          enabled: false,
          clientId: "bot2-key",
          clientSecret: "bot2-secret",
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("should reject non-object accounts", () => {
    const result = DingTalkConfigSchema.safeParse({
      accounts: "not-an-object",
    });
    expect(result.success).toBe(false);
  });
});

describe("DingTalkAccountConfigSchema", () => {
  it("should apply defaults for optional fields", () => {
    const result = DingTalkAccountConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      // All fields should be optional with no defaults at this level
      expect(result.data.clientId).toBeUndefined();
      expect(result.data.clientSecret).toBeUndefined();
    }
  });

  it("should parse a complete account config", () => {
    const result = DingTalkAccountConfigSchema.safeParse({
      name: "Test Bot",
      enabled: true,
      clientId: "key-1",
      clientSecret: "secret-1",
      allowFrom: ["u1", "u2"],
      groupPolicy: "allowlist",
      groupAllowFrom: ["g1"],
    });
    expect(result.success).toBe(true);
  });

  it("should allow groups config", () => {
    const result = DingTalkAccountConfigSchema.safeParse({
      groups: {
        "conv-123": {
          enabled: true,
          allowFrom: ["u1"],
          tools: {
            allow: ["tool-a"],
            deny: ["tool-b"],
          },
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.groups?.["conv-123"]?.tools?.allow).toEqual(["tool-a"]);
      expect(result.data.groups?.["conv-123"]?.tools?.deny).toEqual(["tool-b"]);
    }
  });
});

// ======================= Account Listing =======================

describe("listDingTalkAccountIds", () => {
  it("returns [DEFAULT_ACCOUNT_ID] for empty config", () => {
    expect(listDingTalkAccountIds({})).toEqual(["default"]);
  });

  it("returns [DEFAULT_ACCOUNT_ID] for config with no dingtalk section", () => {
    expect(listDingTalkAccountIds({ channels: {} } as OpenClawConfig)).toEqual([
      "default",
    ]);
  });

  it("includes default when top-level clientId is set", () => {
    const ids = listDingTalkAccountIds({
      channels: {
        dingtalk: {
          clientId: "base-key",
        },
      },
    } as OpenClawConfig);
    expect(ids).toContain("default");
  });

  it("lists configured account keys sorted alphabetically", () => {
    const ids = listDingTalkAccountIds({
      channels: {
        dingtalk: {
          accounts: {
            zebra: { clientId: "zebra-key" },
            alpha: { clientId: "alpha-key" },
          },
        },
      },
    } as OpenClawConfig);
    expect(ids).toEqual(["alpha", "zebra"]);
  });

  it("includes default alongside named accounts when top-level credentials exist", () => {
    const ids = listDingTalkAccountIds({
      channels: {
        dingtalk: {
          clientId: "base-key",
          clientSecret: "base-secret",
          accounts: {
            work: { clientId: "work-id", clientSecret: "work-secret" },
          },
        },
      },
    } as OpenClawConfig);
    expect(ids).toEqual(["default", "work"]);
  });
});

// ======================= Default Account Resolution =======================

describe("resolveDefaultDingTalkAccountId", () => {
  it("returns 'default' when no config", () => {
    expect(resolveDefaultDingTalkAccountId({})).toBe("default");
  });

  it("respects explicit defaultAccount", () => {
    const id = resolveDefaultDingTalkAccountId({
      channels: {
        dingtalk: {
          defaultAccount: "main",
          accounts: {
            main: { clientId: "main-id", clientSecret: "main-secret" },
          },
        },
      },
    } as OpenClawConfig);
    expect(id).toBe("main");
  });

  it("returns 'default' when no explicit defaultAccount is set", () => {
    const id = resolveDefaultDingTalkAccountId({
      channels: {
        dingtalk: {
          clientId: "base-id",
          clientSecret: "base-secret",
        },
      },
    } as OpenClawConfig);
    expect(id).toBe("default");
  });
});

// ======================= Account Config Resolution =======================

describe("resolveDingTalkAccount", () => {
  it("resolves top-level credentials as default account", () => {
    const account = resolveDingTalkAccount({
      cfg: {
        channels: {
          dingtalk: {
            enabled: true,
            clientId: "base-id",
            clientSecret: "base-secret",
          },
        },
      } as OpenClawConfig,
      accountId: "default",
    });
    expect(account.accountId).toBe("default");
    expect(account.clientId).toBe("base-id");
    expect(account.clientSecret).toBe("base-secret");
    expect(account.tokenSource).toBe("config");
    expect(account.enabled).toBe(true);
  });

  it("merges top-level defaults with account-level overrides", () => {
    const account = resolveDingTalkAccount({
      cfg: {
        channels: {
          dingtalk: {
            enabled: true,
            clientId: "base-id",
            clientSecret: "base-secret",
            allowFrom: ["*"],
            groupPolicy: "open",
            accounts: {
              work: {
                clientId: "work-id",
                clientSecret: "work-secret",
                groupPolicy: "allowlist",
              },
            },
          },
        },
      } as OpenClawConfig,
      accountId: "work",
    });
    expect(account.clientId).toBe("work-id"); // overridden
    expect(account.clientSecret).toBe("work-secret"); // overridden
    expect(account.allowFrom).toEqual(["*"]); // inherited
    expect(account.groupPolicy).toBe("allowlist"); // overridden
  });

  it("sets tokenSource to config when credentials are present", () => {
    const account = resolveDingTalkAccount({
      cfg: {
        channels: {
          dingtalk: {
            clientId: "key",
            clientSecret: "secret",
          },
        },
      } as OpenClawConfig,
    });
    expect(account.tokenSource).toBe("config");
  });

  it("sets tokenSource to none when credentials are missing", () => {
    const account = resolveDingTalkAccount({
      cfg: {
        channels: {
          dingtalk: {},
        },
      } as OpenClawConfig,
    });
    expect(account.tokenSource).toBe("none");
    expect(account.clientId).toBe("");
    expect(account.clientSecret).toBe("");
  });

  it("uses default allowFrom of ['*'] when not configured", () => {
    const account = resolveDingTalkAccount({
      cfg: {
        channels: {
          dingtalk: {},
        },
      } as OpenClawConfig,
    });
    expect(account.allowFrom).toEqual(["*"]);
  });

  it("defaults groupPolicy to 'open'", () => {
    const account = resolveDingTalkAccount({
      cfg: {
        channels: {
          dingtalk: {},
        },
      } as OpenClawConfig,
    });
    expect(account.groupPolicy).toBe("open");
  });

  it("defaults groupAllowFrom to empty array", () => {
    const account = resolveDingTalkAccount({
      cfg: {
        channels: {
          dingtalk: {},
        },
      } as OpenClawConfig,
    });
    expect(account.groupAllowFrom).toEqual([]);
  });

  it("inherits groups from channel config for single-account mode", () => {
    const account = resolveDingTalkAccount({
      cfg: {
        channels: {
          dingtalk: {
            clientId: "base-id",
            clientSecret: "base-secret",
            groups: {
              "conv-1": { enabled: false },
            },
          },
        },
      } as OpenClawConfig,
    });
    expect(account.groups).toEqual({ "conv-1": { enabled: false } });
  });
});
