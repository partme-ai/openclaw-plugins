import * as http from "node:http";
import * as net from "node:net";
import type { Duplex } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import { resolveOAuth2Config } from "./config.js";
import { OAuth2ProxyServer } from "./proxy-server.js";

const logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
const servers: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  for (const server of servers.splice(0).reverse()) await server.close();
});

async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind TCP");
  return address.port;
}

async function request(port: number, path: string, headers: http.OutgoingHttpHeaders = {}) {
  return new Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString(), headers: res.headers }));
    });
    req.on("error", reject);
    req.end();
  });
}

async function readForm(req: http.IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return new URLSearchParams(Buffer.concat(chunks).toString("utf-8"));
}

function explicitClient(oauthPort: number) {
  return {
    discovery: false,
    redirectUri: "http://openclaw.example/auth/oauth2/callback",
    authorizationEndpoint: `http://127.0.0.1:${oauthPort}/authorize`,
    tokenEndpoint: `http://127.0.0.1:${oauthPort}/token`,
    introspectionEndpoint: `http://127.0.0.1:${oauthPort}/introspect`,
    sessionSecret: "test-session-secret-that-is-at-least-32-characters",
    secureCookies: false,
    userIdField: "sub",
  } as const;
}

describe("OAuth2ProxyServer", () => {
  it("introspects bearer tokens and strips spoofable identity headers", async () => {
    const oauth = http.createServer(async (req, res) => {
      const form = await readForm(req);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(form.get("token") === "valid-token"
        ? { active: true, sub: "user@example.com", tenantId: "tenant-1", scope: "openclaw:operator" }
        : { active: false }));
    });
    const oauthPort = await listen(oauth);
    servers.push({ close: () => new Promise((resolve) => oauth.close(() => resolve())) });

    const upstream = http.createServer((req, res) => res.end(JSON.stringify(req.headers)));
    const upstreamPort = await listen(upstream);
    servers.push({ close: () => new Promise((resolve) => upstream.close(() => resolve())) });
    const config = resolveOAuth2Config({
      enabled: true,
      issuerUrl: `http://127.0.0.1:${oauthPort}`,
      clientSecret: "secret",
      client: explicitClient(oauthPort),
      proxy: { listenHost: "127.0.0.1", listenPort: 0, upstreamPort },
    });
    const proxy = new OAuth2ProxyServer(config, logger);
    await proxy.start();
    servers.push({ close: () => proxy.stop() });
    const address = proxy.address();
    if (!address || typeof address === "string") throw new Error("proxy did not bind TCP");

    expect((await request(address.port, "/api")).status).toBe(401);
    expect((await request(address.port, "/api?token=valid-token")).status).toBe(401);
    const response = await request(address.port, "/api", {
      authorization: "Bearer valid-token",
      "x-forwarded-user": "attacker@example.com",
      "x-openclaw-scopes": "operator.admin",
      "x-openclaw-tenant": "attacker-tenant",
    });
    expect(response.status).toBe(200);
    const headers = JSON.parse(response.body) as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
    expect(headers["x-forwarded-user"]).toBe("user@example.com");
    expect(headers["x-openclaw-scopes"]).toBe("operator.read operator.write");
    expect(headers["x-openclaw-tenant"]).toBe("tenant-1");
  });

  it("authenticates and proxies WebSocket upgrades", async () => {
    const oauth = http.createServer((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ active: true, sub: "ws-user", scope: "openclaw:viewer" }));
    });
    const oauthPort = await listen(oauth);
    servers.push({ close: () => new Promise((resolve) => oauth.close(() => resolve())) });
    const upstream = http.createServer();
    let upgradedSocket: Duplex | undefined;
    upstream.on("upgrade", (req, socket) => {
      upgradedSocket = socket;
      if (req.headers["x-forwarded-user"] !== "ws-user") return socket.destroy();
      socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
    });
    const upstreamPort = await listen(upstream);
    servers.push({ close: () => new Promise((resolve) => {
      upgradedSocket?.destroy();
      upstream.close(() => resolve());
    }) });
    const config = resolveOAuth2Config({
      enabled: true,
      issuerUrl: `http://127.0.0.1:${oauthPort}`,
      clientSecret: "secret",
      client: explicitClient(oauthPort),
      proxy: { listenHost: "127.0.0.1", listenPort: 0, upstreamPort },
    });
    const proxy = new OAuth2ProxyServer(config, logger);
    await proxy.start();
    servers.push({ close: () => proxy.stop() });
    const address = proxy.address();
    if (!address || typeof address === "string") throw new Error("proxy did not bind TCP");

    const result = await new Promise<string>((resolve, reject) => {
      const socket = net.connect(address.port, "127.0.0.1");
      let data = "";
      socket.on("connect", () => socket.write(
        "GET /ws HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nAuthorization: Bearer valid-token\r\n\r\n",
      ));
      socket.on("data", (chunk) => {
        data += chunk.toString();
        if (data.includes("101 Switching Protocols")) {
          socket.destroy();
          resolve(data);
        }
      });
      socket.on("error", reject);
    });
    expect(result).toContain("101 Switching Protocols");
  });

  it("completes standard authorization-code PKCE, refresh, userinfo, and revoke", async () => {
    let refreshCalls = 0;
    let revokeCalls = 0;
    let exchangedCodeVerifier = "";
    const oauthServer = http.createServer(async (req, res) => {
      const path = new URL(req.url ?? "/", "http://oauth.local").pathname;
      res.setHeader("content-type", "application/json");
      if (path === "/token") {
        const form = await readForm(req);
        if (form.get("grant_type") === "refresh_token") refreshCalls += 1;
        else exchangedCodeVerifier = form.get("code_verifier") ?? "";
        res.end(JSON.stringify({
          access_token: refreshCalls ? "access-2" : "access-1",
          refresh_token: "refresh-1",
          token_type: "Bearer",
          expires_in: refreshCalls ? 3600 : 1,
          scope: "openclaw:operator",
        }));
      } else if (path === "/revoke") {
        revokeCalls += 1;
        res.end("{}");
      } else if (path === "/userinfo") {
        expect(req.headers.authorization).toBe("Bearer access-1");
        res.end(JSON.stringify({ sub: "browser-user", tenantId: "tenant-browser" }));
      } else {
        res.writeHead(404).end();
      }
    });
    const oauthPort = await listen(oauthServer);
    servers.push({ close: () => new Promise((resolve) => oauthServer.close(() => resolve())) });
    const upstream = http.createServer((req, res) => res.end(String(req.headers["x-forwarded-user"] ?? "missing")));
    const upstreamPort = await listen(upstream);
    servers.push({ close: () => new Promise((resolve) => upstream.close(() => resolve())) });
    const config = resolveOAuth2Config({
      enabled: true,
      issuerUrl: `http://127.0.0.1:${oauthPort}`,
      clientSecret: "client-secret",
      client: {
        ...explicitClient(oauthPort),
        introspectionEndpoint: undefined,
        userInfoEndpoint: `http://127.0.0.1:${oauthPort}/userinfo`,
        revokeEndpoint: `http://127.0.0.1:${oauthPort}/revoke`,
        authorizationParameters: { audience: "openclaw-api" },
      },
      proxy: { listenHost: "127.0.0.1", listenPort: 0, upstreamPort },
    });
    const proxy = new OAuth2ProxyServer(config, logger);
    await proxy.start();
    servers.push({ close: () => proxy.stop() });
    const address = proxy.address();
    if (!address || typeof address === "string") throw new Error("proxy did not bind TCP");

    const deniedLogin = await request(address.port, "/auth/oauth2/login?returnTo=%2Fdenied");
    const deniedUrl = new URL(String(deniedLogin.headers.location));
    const deniedState = deniedUrl.searchParams.get("state");
    const deniedCookie = deniedLogin.headers["set-cookie"]?.[0]?.split(";", 1)[0];
    const denied = await request(address.port, `/auth/oauth2/callback?error=access_denied&state=${deniedState}`, { cookie: deniedCookie });
    expect(denied.status).toBe(401);
    expect(denied.headers["set-cookie"]?.[0]).toContain("Max-Age=0");

    const login = await request(address.port, "/auth/oauth2/login?returnTo=%2Fdashboard");
    const authorizationUrl = new URL(String(login.headers.location));
    expect(authorizationUrl.pathname).toBe("/authorize");
    expect(authorizationUrl.searchParams.get("response_type")).toBe("code");
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorizationUrl.searchParams.get("audience")).toBe("openclaw-api");
    const state = authorizationUrl.searchParams.get("state");
    const stateCookie = login.headers["set-cookie"]?.[0]?.split(";", 1)[0];
    const callback = await request(address.port, `/auth/oauth2/callback?code=code-1&state=${state}`, { cookie: stateCookie });
    expect(callback.status).toBe(302);
    expect(callback.headers.location).toBe("/dashboard");
    expect(exchangedCodeVerifier.length).toBeGreaterThan(40);
    const sessionCookie = callback.headers["set-cookie"]?.[0]?.split(";", 1)[0];
    const authenticated = await request(address.port, "/dashboard", { cookie: sessionCookie });
    expect(authenticated.status).toBe(200);
    expect(authenticated.body).toBe("browser-user");
    expect(refreshCalls).toBe(1);
    const logout = await request(address.port, "/auth/oauth2/logout", { cookie: sessionCookie });
    expect(logout.status).toBe(302);
    expect(revokeCalls).toBe(1);
  });
});
