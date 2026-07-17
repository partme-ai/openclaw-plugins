import { describe, expect, it } from "vitest";

import type { OAuth2ClientConfig } from "../shared/types.js";
import { OAuth2SessionStore } from "./session-store.js";

const config: OAuth2ClientConfig = {
  redirectUri: "https://openclaw.example/auth/oauth2/callback",
  discovery: true,
  scopes: ["userinfo"],
  requiredScopes: [],
  successRedirect: "/",
  sessionSecret: "memory-test-session-secret-at-least-32-characters",
  sessionCookieName: "openclaw_oauth2_session",
  sessionTtlSeconds: 300,
  stateTtlSeconds: 300,
  secureCookies: false,
  userIdField: "loginId",
  unauthorizedMode: "auto",
  clientAuthMethod: "client_secret_post",
  authorizationParameters: {},
  tokenParameters: {},
  requestTimeoutMs: 5_000,
  sessionStore: { type: "memory", keyPrefix: "test:openclaw:oauth2", maxEntries: 100 },
};

describe("OAuth2SessionStore authorization transactions", () => {
  it("keeps concurrent login states in independent signed cookies", async () => {
    const store = new OAuth2SessionStore(config);
    await store.start();
    const first = await store.createAuthorizationState("/first", "verifier-first");
    const second = await store.createAuthorizationState("/second", "verifier-second");
    const firstCookie = first.cookie.split(";", 1)[0];
    const secondCookie = second.cookie.split(";", 1)[0];
    expect(firstCookie.split("=", 1)[0]).not.toBe(secondCookie.split("=", 1)[0]);

    const headers = { cookie: `${firstCookie}; ${secondCookie}` };
    expect(await store.consumeAuthorizationState(first.state, headers)).toMatchObject({
      returnTo: "/first",
      codeVerifier: "verifier-first",
    });
    expect(await store.consumeAuthorizationState(second.state, headers)).toMatchObject({
      returnTo: "/second",
      codeVerifier: "verifier-second",
    });
    await store.stop();
  });

  it("consumes each state exactly once", async () => {
    const store = new OAuth2SessionStore(config);
    const transaction = await store.createAuthorizationState("/dashboard", "verifier");
    const headers = { cookie: transaction.cookie.split(";", 1)[0] };
    expect(await store.consumeAuthorizationState(transaction.state, headers)).toMatchObject({ returnTo: "/dashboard" });
    expect(await store.consumeAuthorizationState(transaction.state, headers)).toBeNull();
  });

  it("does not consume a state before its signed browser cookie is verified", async () => {
    const store = new OAuth2SessionStore(config);
    const transaction = await store.createAuthorizationState("/dashboard", "verifier");

    expect(await store.consumeAuthorizationState(transaction.state, {})).toBeNull();
    expect(await store.consumeAuthorizationState(transaction.state, {
      cookie: transaction.cookie.split(";", 1)[0],
    })).toMatchObject({ returnTo: "/dashboard" });
  });

  it("bounds the in-memory authorization and session store", async () => {
    const store = new OAuth2SessionStore({
      ...config,
      sessionStore: { ...config.sessionStore, maxEntries: 1 },
    });
    await store.createAuthorizationState("/first", "verifier-first");

    await expect(store.createAuthorizationState("/second", "verifier-second")).rejects.toThrow(
      /capacity 1 reached/,
    );
  });
});
