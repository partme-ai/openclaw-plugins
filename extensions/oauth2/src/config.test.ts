import { describe, expect, it } from "vitest";

import { resolveOAuth2Config, validateOAuth2GatewayIntegration } from "./config.js";

const baseConfig = {
  enabled: true,
  issuerUrl: "https://auth.example.com",
  clientId: "openclaw-client",
  client: {
    redirectUri: "https://openclaw.example.com/auth/oauth2/callback",
    sessionSecret: "test-session-secret-at-least-32-characters",
  },
};

describe("resolveOAuth2Config", () => {
  it("supports public clients and configurable standard endpoints", () => {
    const config = resolveOAuth2Config({
      ...baseConfig,
      client: {
        ...baseConfig.client,
        discovery: false,
        clientAuthMethod: "none",
        authorizationEndpoint: "https://auth.example.com/oauth2/authorize",
        tokenEndpoint: "https://auth.example.com/oauth2/token",
        userInfoEndpoint: "https://auth.example.com/oauth2/userinfo",
        authorizationParameters: { audience: "openclaw-api" },
        tokenParameters: { resource: "https://openclaw.example.com" },
      },
    });

    expect(config.clientSecret).toBeUndefined();
    expect(config.client.authorizationParameters.audience).toBe("openclaw-api");
    expect(config.client.tokenParameters.resource).toBe("https://openclaw.example.com");
  });

  it("rejects attempts to override PKCE and token exchange parameters", () => {
    expect(() => resolveOAuth2Config({
      ...baseConfig,
      clientSecret: "client-secret",
      client: {
        ...baseConfig.client,
        authorizationParameters: { state: "attacker-controlled" },
      },
    })).toThrow(/authorizationParameters\.state.*cannot be overridden/);

    expect(() => resolveOAuth2Config({
      ...baseConfig,
      clientSecret: "client-secret",
      client: {
        ...baseConfig.client,
        tokenParameters: { code_verifier: "attacker-controlled" },
      },
    })).toThrow(/tokenParameters\.code_verifier.*cannot be overridden/);
  });

  it("rejects unsafe identity headers and invalid memory capacity", () => {
    expect(() => resolveOAuth2Config({
      proxy: { userHeader: "authorization" },
    })).toThrow(/reserved header/);
    expect(() => resolveOAuth2Config({
      client: { sessionStore: { maxEntries: 0 } },
    })).toThrow(/positive safe integer/);
  });

  it("rejects unsafe redirect, cookie, scope and TTL configuration", () => {
    expect(() => resolveOAuth2Config({
      ...baseConfig,
      clientSecret: "client-secret",
      client: { ...baseConfig.client, successRedirect: "https://evil.example/steal" },
    })).toThrow(/successRedirect must be a local absolute path/);
    expect(() => resolveOAuth2Config({
      ...baseConfig,
      clientSecret: "client-secret",
      client: { ...baseConfig.client, redirectUri: "http://openclaw.example.com/callback" },
    })).toThrow(/redirectUri must use HTTPS/);
    expect(() => resolveOAuth2Config({
      client: { sessionCookieName: "invalid cookie" },
    })).toThrow(/valid cookie name/);
    expect(() => resolveOAuth2Config({
      client: { scopes: ["openid profile"] },
    })).toThrow(/scopes entries must be non-empty scope tokens/);
    expect(() => resolveOAuth2Config({
      client: { stateTtlSeconds: 1 },
    })).toThrow(/stateTtlSeconds must be a safe integer/);
  });

  it("only proxies to a loopback OpenClaw Gateway", () => {
    expect(() => resolveOAuth2Config({
      ...baseConfig,
      clientSecret: "client-secret",
      proxy: { upstreamHost: "gateway.internal" },
    })).toThrow(/proxy\.upstreamHost must be 127\.0\.0\.1 or ::1/);
  });

  it("fails closed when OpenClaw trusted-proxy integration does not match", () => {
    const config = resolveOAuth2Config({ ...baseConfig, clientSecret: "client-secret" });
    const validGateway = {
      gateway: {
        port: 18789,
        trustedProxies: ["127.0.0.1"],
        auth: {
          mode: "trusted-proxy",
          trustedProxy: { userHeader: "x-forwarded-user", allowLoopback: true },
        },
      },
    };

    expect(() => validateOAuth2GatewayIntegration(config, validGateway)).not.toThrow();
    expect(() => validateOAuth2GatewayIntegration(config, {
      gateway: { ...validGateway.gateway, auth: { mode: "none" } },
    })).toThrow(/auth\.mode must be trusted-proxy/);
    expect(() => validateOAuth2GatewayIntegration(config, {
      gateway: {
        ...validGateway.gateway,
        auth: { mode: "trusted-proxy", trustedProxy: { userHeader: "x-user", allowLoopback: true } },
      },
    })).toThrow(/userHeader must equal x-forwarded-user/);
    expect(() => validateOAuth2GatewayIntegration(config, {
      gateway: { ...validGateway.gateway, trustedProxies: [] },
    })).toThrow(/trustedProxies must include 127\.0\.0\.1/);
    expect(() => validateOAuth2GatewayIntegration(config, {
      gateway: { ...validGateway.gateway, port: 19789 },
    })).toThrow(/must match gateway\.port/);
  });
});
