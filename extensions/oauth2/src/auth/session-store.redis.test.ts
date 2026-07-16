import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { OAuth2ClientConfig } from "../shared/types.js";
import { OAuth2SessionStore } from "./session-store.js";

const redisUrl = process.env.TEST_REDIS_URL;
const suite = redisUrl ? describe : describe.skip;

suite("OAuth2SessionStore Redis", () => {
  const config: OAuth2ClientConfig = {
    redirectUri: "https://openclaw.example/auth/oauth2/callback",
    discovery: true,
    scopes: ["userinfo"],
    requiredScopes: [],
    successRedirect: "/",
    sessionSecret: "redis-test-session-secret-at-least-32-characters",
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
    sessionStore: { type: "redis", redisUrl, keyPrefix: `test:openclaw:oauth2:${Date.now()}`, maxEntries: 100 },
  };
  const first = new OAuth2SessionStore(config);
  const second = new OAuth2SessionStore(config);

  beforeAll(async () => { await first.start(); await second.start(); });
  afterAll(async () => { await first.stop(); await second.stop(); });

  it("shares state and sessions across proxy instances", async () => {
    const authorization = await first.createAuthorizationState("/dashboard", "redis-verifier");
    const stateCookie = authorization.cookie.split(";", 1)[0];
    expect(await second.consumeAuthorizationState(authorization.state, { cookie: stateCookie })).toMatchObject({
      returnTo: "/dashboard",
      codeVerifier: "redis-verifier",
    });

    const created = await first.createSession(
      { authenticated: true, loginId: "redis-user" },
      { accessToken: "access", tokenType: "bearer", expiresAt: Date.now() + 60_000 },
    );
    const sessionCookie = created.cookie.split(";", 1)[0];
    expect((await second.getSession({ cookie: sessionCookie }))?.context.loginId).toBe("redis-user");
    await second.deleteSession({ cookie: sessionCookie });
    expect(await first.getSession({ cookie: sessionCookie })).toBeNull();
  });
});
