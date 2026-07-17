import { describe, expect, it } from "vitest";

import {
  listGotifyAccountIds,
  resolveDefaultGotifyAccountId,
  resolveGotifyAccount,
  validateGotifyAccount,
} from "../src/config.js";

describe("config", () => {
  it("resolves single-account top-level config", () => {
    const account = resolveGotifyAccount(
      {
        channels: {
          gotify: {
            serverUrl: "https://push.example.com",
            appToken: "app-token",
          },
        },
      },
      "default",
    );

    expect(account.configured).toBe(true);
    expect(account.accountId).toBe("default");
    expect(account.serverUrl).toBe("https://push.example.com");
    expect(account.inbound.enabled).toBe(false);
    expect(account.inbound.maxDispatchAttempts).toBe(5);
    expect(account.inbound.dispatchRetryDelayMs).toBe(1000);
    expect(account.inbound.maxDispatchRetryDelayMs).toBe(30_000);
  });

  it("prefers explicit default account from accounts map", () => {
    const cfg = {
      channels: {
        gotify: {
          defaultAccount: "ops",
          accounts: {
            ops: {
              serverUrl: "https://ops.example.com",
              appToken: "ops-token",
            },
            alert: {
              serverUrl: "https://alert.example.com",
              appToken: "alert-token",
            },
          },
        },
      },
    };

    expect(resolveDefaultGotifyAccountId(cfg)).toBe("ops");
    expect(listGotifyAccountIds(cfg)).toEqual(["ops", "alert"]);
    expect(resolveGotifyAccount(cfg, null).serverUrl).toBe(
      "https://ops.example.com",
    );
  });

  it("normalizes inbound.allowedAppId as a positive integer", () => {
    const account = resolveGotifyAccount(
      {
        channels: {
          gotify: {
            accounts: {
              e2e: {
                serverUrl: "https://push.example.com",
                appToken: "app-token",
                clientToken: "client-token",
                inbound: {
                  enabled: true,
                  allowedAppId: "42",
                },
              },
            },
          },
        },
      },
      "e2e",
    );

    expect(account.inbound.allowedAppId).toBe(42);
  });

  it("preserves explicit invalid values so startup validation fails closed", () => {
    const account = resolveGotifyAccount(
      {
        channels: {
          gotify: {
            serverUrl: "ftp://user:pass@example.com",
            appToken: "app-token",
            defaultPriority: 99,
            dmPolicy: "unknown",
            inbound: {
              enabled: true,
              reconnectDelayMs: "fast",
              reconnectJitterRatio: 2,
              maxBufferedMessages: 0,
              maxDispatchAttempts: 0,
              dispatchRetryDelayMs: 5000,
              maxDispatchRetryDelayMs: 1000,
            },
          },
        },
      } as never,
      "default",
    );

    expect(validateGotifyAccount(account)).toEqual(
      expect.arrayContaining([
        "serverUrl must use http or https",
        "serverUrl must not contain userinfo credentials",
        "inbound.enabled requires clientToken",
        "inbound.enabled requires inbound.allowedAppId",
        "defaultPriority must be an integer between 0 and 10",
        "dmPolicy is invalid: unknown",
        "inbound.reconnectDelayMs must be a safe integer >= 500",
        "inbound.reconnectJitterRatio must be between 0 and 1",
        "inbound.maxBufferedMessages must be a safe integer >= 1",
        "inbound.maxDispatchAttempts must be a safe integer >= 1",
        "inbound.maxDispatchRetryDelayMs must be >= dispatchRetryDelayMs",
      ]),
    );
  });
});
