import * as http from "node:http";
import type { Duplex } from "node:stream";

import { OAuth2Client } from "./auth/oauth2-client.js";
import { extractBearerToken, toOpenClawScopes } from "./auth/request-auth.js";
import { mapScopesToPermissions, mapScopesToRole, parseScopeString } from "./auth/scope-mapper.js";
import { OAuth2SessionStore } from "./auth/session-store.js";
import type { AuthContext, AuthOAuth2Config, OAuth2ProxyConfig } from "./shared/types.js";

export type OAuth2ProxyLogger = {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
};

const STRIPPED_HEADERS = new Set([
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-user",
  "x-real-ip",
  "x-openclaw-scopes",
  "x-openclaw-tenant",
]);

function pathnameOf(url: string | undefined): string {
  try {
    return new URL(url ?? "/", "http://openclaw-oauth2.local").pathname;
  } catch {
    return "/";
  }
}

function serializeUpgradeResponse(response: http.IncomingMessage): string {
  const headers: string[] = [];
  for (let index = 0; index < response.rawHeaders.length; index += 2) {
    headers.push(`${response.rawHeaders[index]}: ${response.rawHeaders[index + 1]}`);
  }
  return `HTTP/1.1 ${response.statusCode ?? 101} ${response.statusMessage ?? "Switching Protocols"}\r\n${headers.join("\r\n")}\r\n\r\n`;
}

function rejectHttp(response: http.ServerResponse, message: string): void {
  response.writeHead(401, {
    "content-type": "application/json; charset=utf-8",
    "www-authenticate": 'Bearer realm="openclaw", error="invalid_token"',
    connection: "close",
  });
  response.end(JSON.stringify({ error: "oauth2_authentication_failed", message }));
}

function rejectUpgrade(socket: Duplex, message: string): void {
  const body = JSON.stringify({ error: "oauth2_authentication_failed", message });
  socket.end(
    "HTTP/1.1 401 Unauthorized\r\n" +
      "Content-Type: application/json; charset=utf-8\r\n" +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      'WWW-Authenticate: Bearer realm="openclaw", error="invalid_token"\r\n' +
      "Connection: close\r\n\r\n" +
      body,
  );
}

export function buildOAuth2ForwardHeaders(
  source: http.IncomingHttpHeaders,
  context: AuthContext,
  remoteAddress: string | undefined,
  proxy: OAuth2ProxyConfig,
): http.OutgoingHttpHeaders {
  const headers: http.OutgoingHttpHeaders = {};
  const configuredIdentityHeaders = new Set([
    proxy.userHeader.toLowerCase(),
    proxy.tenantHeader?.toLowerCase(),
  ]);
  for (const [name, value] of Object.entries(source)) {
    const lower = name.toLowerCase();
    if (lower === "authorization" || STRIPPED_HEADERS.has(lower) || configuredIdentityHeaders.has(lower)) continue;
    headers[lower] = value;
  }
  headers[proxy.userHeader.toLowerCase()] = context.loginId;
  headers["x-openclaw-scopes"] = toOpenClawScopes(context).join(" ");
  headers["x-forwarded-for"] = remoteAddress ?? "unknown";
  headers["x-forwarded-proto"] = "http";
  if (proxy.tenantHeader && context.tenantId) headers[proxy.tenantHeader.toLowerCase()] = context.tenantId;
  return headers;
}

export class OAuth2ProxyServer {
  private server: http.Server | null = null;
  private readonly upgradedSockets = new Set<Duplex>();
  private readonly oauthClient: OAuth2Client;
  private readonly sessions: OAuth2SessionStore;

  constructor(
    private readonly config: AuthOAuth2Config,
    private readonly logger: OAuth2ProxyLogger,
  ) {
    if (!config.client) throw new Error("[openclaw-oauth2] OAuth2 client configuration is missing");
    this.oauthClient = new OAuth2Client(config);
    this.sessions = new OAuth2SessionStore(config.client);
  }

  async start(): Promise<void> {
    if (this.server) return;
    await this.oauthClient.start();
    await this.sessions.start();
    const server = http.createServer((request, response) => {
      void this.handleHttp(request, response);
    });
    server.on("upgrade", (request, socket, head) => {
      void this.handleUpgrade(request, socket, head);
    });
    server.on("clientError", (error, socket) => {
      this.logger.warn(`[openclaw-oauth2] client error: ${error.message}`);
      socket.destroy();
    });
    const proxy = this.proxyConfig();
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(proxy.listenPort, proxy.listenHost, () => {
          server.off("error", reject);
          resolve();
        });
      });
    } catch (error) {
      await this.sessions.stop().catch(() => undefined);
      throw error;
    }
    this.server = server;
    this.logger.info(`[openclaw-oauth2] listening on http://${proxy.listenHost}:${proxy.listenPort} -> http://${proxy.upstreamHost}:${proxy.upstreamPort}`);
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) {
      await this.sessions.stop();
      return;
    }
    for (const socket of this.upgradedSockets) socket.destroy();
    this.upgradedSockets.clear();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
    await this.sessions.stop();
  }

  address(): ReturnType<http.Server["address"]> {
    return this.server?.address() ?? null;
  }

  private proxyConfig(): OAuth2ProxyConfig {
    if (!this.config.proxy) throw new Error("[openclaw-oauth2] proxy configuration is missing");
    return this.config.proxy;
  }

  private async authenticate(request: http.IncomingMessage): Promise<AuthContext | null> {
    const token = extractBearerToken(request);
    if (token) {
      const user = await this.oauthClient.authenticateAccessToken(token);
      if (!user) return null;
      const scopes = parseScopeString(user.scope);
      return {
        authenticated: true,
        loginId: user.userId,
        tenantId: user.tenantId,
        scopes,
        role: mapScopesToRole(scopes, this.config),
        permissions: mapScopesToPermissions(scopes, this.config),
      };
    }

    const session = await this.sessions.getSession(request.headers);
    if (!session) return null;
    if (session.tokens.expiresAt <= Date.now() + 30_000) {
      if (!session.tokens.refreshToken || (session.tokens.refreshExpiresAt ?? Number.POSITIVE_INFINITY) <= Date.now()) {
        return null;
      }
      const refreshed = await this.oauthClient.refresh(session.tokens.refreshToken);
      session.tokens = {
        ...refreshed,
        refreshToken: refreshed.refreshToken ?? session.tokens.refreshToken,
        refreshExpiresAt: refreshed.refreshExpiresAt ?? session.tokens.refreshExpiresAt,
      };
      await this.sessions.saveSession(session);
    }
    return session.context;
  }

  private async serveLocalEndpoint(request: http.IncomingMessage, response: http.ServerResponse): Promise<boolean> {
    const path = pathnameOf(request.url);
    if (path === "/health" || path === "/auth/oauth2/status") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true, plugin: "openclaw-oauth2", ready: this.oauthClient.isReady() }));
      return true;
    }
    if (path === "/auth/oauth2/login") {
      const url = new URL(request.url ?? path, "http://openclaw-oauth2.local");
      const codeVerifier = this.oauthClient.createCodeVerifier();
      const { state, cookie } = await this.sessions.createAuthorizationState(
        url.searchParams.get("returnTo") ?? undefined,
        codeVerifier,
      );
      const authorizationUrl = await this.oauthClient.buildAuthorizationUrl(state, codeVerifier);
      response.writeHead(302, { location: authorizationUrl.toString(), "set-cookie": cookie, "cache-control": "no-store" });
      response.end();
      return true;
    }
    if (path === "/auth/oauth2/callback") {
      const url = new URL(request.url ?? path, "http://openclaw-oauth2.local");
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (!state) {
        rejectHttp(response, "OAuth2 authorization callback is missing code or state");
        return true;
      }
      const transaction = await this.sessions.consumeAuthorizationState(state, request.headers);
      if (!transaction) {
        rejectHttp(response, "OAuth2 state is invalid or expired");
        return true;
      }
      if (!code || url.searchParams.has("error")) {
        response.setHeader("set-cookie", this.sessions.clearStateCookie(state));
        rejectHttp(response, "OAuth2 authorization was denied or callback code is missing");
        return true;
      }
      try {
        const callbackUrl = new URL(request.url ?? path, this.config.client.redirectUri);
        const tokens = await this.oauthClient.exchangeCode(callbackUrl, state, transaction.codeVerifier);
        const user = await this.oauthClient.resolveIdentity(tokens);
        if (!user) throw new Error("OAuth2 access token is inactive");
        const scopes = parseScopeString(tokens.scope ?? user.scope);
        const context: AuthContext = {
          authenticated: true,
          loginId: user.userId,
          tenantId: user.tenantId,
          scopes,
          role: mapScopesToRole(scopes, this.config),
          permissions: mapScopesToPermissions(scopes, this.config),
        };
        const { cookie } = await this.sessions.createSession(context, tokens);
        response.writeHead(302, {
          location: transaction.returnTo,
          "set-cookie": [cookie, this.sessions.clearStateCookie(state)],
          "cache-control": "no-store",
        });
        response.end();
      } catch (error) {
        this.logger.warn(`[openclaw-oauth2] authorization callback failed: ${error instanceof Error ? error.message : String(error)}`);
        response.setHeader("set-cookie", this.sessions.clearStateCookie(state));
        rejectHttp(response, "OAuth2 authorization failed");
      }
      return true;
    }
    if (path === "/auth/oauth2/logout") {
      const session = await this.sessions.deleteSession(request.headers);
      if (session) await this.oauthClient.revoke(session.tokens.accessToken).catch(() => undefined);
      response.writeHead(302, { location: "/", "set-cookie": this.sessions.clearCookie(), "cache-control": "no-store" });
      response.end();
      return true;
    }
    return false;
  }

  private async handleHttp(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    if (await this.serveLocalEndpoint(request, response)) return;
    const context = await this.authenticate(request).catch((error) => {
      this.logger.warn(`[openclaw-oauth2] authentication failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    });
    if (!context?.loginId) {
      const acceptsHtml = request.headers.accept?.includes("text/html") === true;
      const mode = this.config.client?.unauthorizedMode ?? "auto";
      if (mode === "redirect" || (mode === "auto" && acceptsHtml)) {
        const returnTo = encodeURIComponent(request.url ?? "/");
        response.writeHead(302, { location: `/auth/oauth2/login?returnTo=${returnTo}`, "cache-control": "no-store" });
        response.end();
        return;
      }
      return rejectHttp(response, "Missing, invalid, or expired OAuth2 session or bearer token");
    }

    const proxy = this.proxyConfig();
    const upstream = http.request({
      host: proxy.upstreamHost,
      port: proxy.upstreamPort,
      method: request.method,
      path: request.url,
      headers: buildOAuth2ForwardHeaders(request.headers, context, request.socket.remoteAddress, proxy),
    }, (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    });
    upstream.setTimeout(proxy.requestTimeoutMs, () => upstream.destroy(new Error("upstream request timed out")));
    upstream.on("error", (error) => {
      this.logger.error(`[openclaw-oauth2] upstream HTTP error: ${error.message}`);
      if (!response.headersSent) response.writeHead(502, { "content-type": "application/json" });
      if (!response.writableEnded) response.end(JSON.stringify({ error: "bad_gateway" }));
    });
    request.pipe(upstream);
  }

  private async handleUpgrade(request: http.IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const context = await this.authenticate(request).catch(() => null);
    if (!context?.loginId) return rejectUpgrade(socket, "Missing, invalid, or expired bearer token");
    const proxy = this.proxyConfig();
    const upstream = http.request({
      host: proxy.upstreamHost,
      port: proxy.upstreamPort,
      method: request.method,
      path: request.url,
      headers: buildOAuth2ForwardHeaders(request.headers, context, request.socket.remoteAddress, proxy),
    });
    upstream.setTimeout(proxy.requestTimeoutMs, () => upstream.destroy(new Error("upstream upgrade timed out")));
    upstream.on("upgrade", (upstreamResponse, upstreamSocket, upstreamHead) => {
      socket.write(serializeUpgradeResponse(upstreamResponse));
      if (upstreamHead.length > 0) socket.write(upstreamHead);
      if (head.length > 0) upstreamSocket.write(head);
      this.upgradedSockets.add(socket);
      this.upgradedSockets.add(upstreamSocket);
      let closed = false;
      const cleanup = () => {
        if (closed) return;
        closed = true;
        this.upgradedSockets.delete(socket);
        this.upgradedSockets.delete(upstreamSocket);
        if (!socket.destroyed) socket.destroy();
        if (!upstreamSocket.destroyed) upstreamSocket.destroy();
      };
      socket.once("close", cleanup);
      upstreamSocket.once("close", cleanup);
      socket.pipe(upstreamSocket).pipe(socket);
    });
    upstream.on("response", (upstreamResponse) => {
      socket.write(serializeUpgradeResponse(upstreamResponse));
      upstreamResponse.pipe(socket);
    });
    upstream.on("error", (error) => {
      this.logger.error(`[openclaw-oauth2] upstream WebSocket error: ${error.message}`);
      if (!socket.destroyed) socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
    });
    upstream.end();
  }
}
