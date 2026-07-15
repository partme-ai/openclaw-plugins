import * as http from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { resolveOAuth2Config } from "../config.js";
import { OAuth2Client } from "./oauth2-client.js";

let server: http.Server | null = null;

afterEach(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
  server = null;
});

describe("OAuth2Client discovery", () => {
  it("discovers standard metadata and builds a configurable PKCE authorization URL", async () => {
    server = http.createServer((req, res) => {
      if (req.url !== "/.well-known/openid-configuration") return res.writeHead(404).end();
      const address = server?.address();
      if (!address || typeof address === "string") return res.writeHead(500).end();
      const issuer = `http://127.0.0.1:${address.port}`;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        userinfo_endpoint: `${issuer}/userinfo`,
        revocation_endpoint: `${issuer}/revoke`,
        introspection_endpoint: `${issuer}/introspect`,
        code_challenge_methods_supported: ["S256"],
      }));
    });
    await new Promise<void>((resolve, reject) => {
      server?.once("error", reject);
      server?.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("server did not bind TCP");
    const config = resolveOAuth2Config({
      enabled: true,
      issuerUrl: `http://127.0.0.1:${address.port}`,
      clientId: "openclaw-client",
      clientSecret: "client-secret",
      client: {
        discovery: true,
        redirectUri: "http://127.0.0.1/callback",
        sessionSecret: "discovery-test-secret-at-least-32-characters",
        secureCookies: false,
        authorizationParameters: { audience: "openclaw-api", prompt: "login" },
      },
    });
    const client = new OAuth2Client(config);
    await client.start();
    const verifier = client.createCodeVerifier();
    const url = await client.buildAuthorizationUrl("state-value", verifier);
    expect(url.pathname).toBe("/authorize");
    expect(url.searchParams.get("client_id")).toBe("openclaw-client");
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1/callback");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("audience")).toBe("openclaw-api");
    expect(url.searchParams.get("prompt")).toBe("login");
  });
});
