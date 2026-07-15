import { describe, expect, it } from "vitest";

import { resolveOAuth2Config } from "./config.js";

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
});
