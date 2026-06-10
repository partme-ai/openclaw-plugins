/**
 * Douyin channel config resolution tests.
 */
import { describe, expect, it } from "vitest";

import {
  listDouyinAccountIds,
  resolveDefaultDouyinAccountId,
  resolveDouyinAccount,
} from "../src/config.js";

describe("resolveDouyinAccount", () => {
  it("merges top-level credentials into default account", () => {
    const account = resolveDouyinAccount(
      {
        channels: {
          douyin: {
            app_key: "key-top",
            app_secret: "secret-top",
            shop_id: "shop-1",
          },
        },
      },
      "default",
    );

    expect(account.accountId).toBe("default");
    expect(account.configured).toBe(true);
    expect(account.app_key).toBe("key-top");
    expect(account.app_secret).toBe("secret-top");
    expect(account.shop_id).toBe("shop-1");
    expect(account.webhook_path).toBe("/channels/douyin/webhook");
  });

  it("marks account unconfigured when credentials missing", () => {
    const account = resolveDouyinAccount({ channels: { douyin: { shop_id: "s1" } } }, "default");
    expect(account.configured).toBe(false);
    expect(account.enabled).toBe(true);
  });

  it("merges accounts map entry over channel defaults", () => {
    const account = resolveDouyinAccount(
      {
        channels: {
          douyin: {
            app_key: "shared-key",
            app_secret: "shared-secret",
            webhook_path: "/custom/webhook",
            accounts: {
              ops: {
                app_secret: "ops-secret",
                shop_id: "ops-shop",
              },
            },
          },
        },
      },
      "ops",
    );

    expect(account.accountId).toBe("ops");
    expect(account.app_key).toBe("shared-key");
    expect(account.app_secret).toBe("ops-secret");
    expect(account.shop_id).toBe("ops-shop");
    expect(account.webhook_path).toBe("/custom/webhook");
    expect(account.configured).toBe(true);
  });

  it("uses custom webhook_path when provided", () => {
    const account = resolveDouyinAccount(
      {
        channels: {
          douyin: {
            app_key: "k",
            app_secret: "s",
            webhook_path: "  /hooks/douyin  ",
          },
        },
      },
      "default",
    );
    expect(account.webhook_path).toBe("/hooks/douyin");
  });

  it("respects enabled=false on merged account", () => {
    const account = resolveDouyinAccount(
      {
        channels: {
          douyin: {
            app_key: "k",
            app_secret: "s",
            enabled: false,
          },
        },
      },
      "default",
    );
    expect(account.enabled).toBe(false);
  });
});

describe("listDouyinAccountIds", () => {
  it("includes implicit default when top-level credentials exist", () => {
    const ids = listDouyinAccountIds({
      channels: { douyin: { app_key: "k", app_secret: "s", accounts: { ops: {} } } },
    });
    expect(ids).toContain("default");
    expect(ids).toContain("ops");
  });

  it("returns only explicit accounts when top-level credentials absent", () => {
    const ids = listDouyinAccountIds({
      channels: { douyin: { accounts: { a: { app_key: "k", app_secret: "s" } } } },
    });
    expect(ids).toEqual(["a"]);
  });

  it("returns empty list when channel section missing", () => {
    expect(listDouyinAccountIds({ channels: {} })).toEqual([]);
  });
});

describe("resolveDefaultDouyinAccountId", () => {
  it("returns first listed account id", () => {
    const cfg = {
      channels: {
        douyin: {
          app_key: "k",
          app_secret: "s",
          accounts: { beta: { shop_id: "b" } },
        },
      },
    };
    expect(resolveDefaultDouyinAccountId(cfg)).toBe(listDouyinAccountIds(cfg)[0]);
  });

  it("falls back to default when no accounts configured", () => {
    expect(resolveDefaultDouyinAccountId({ channels: {} })).toBe("default");
  });
});
