/**
 * @fileoverview OAuth2/OIDC 授权拦截与 OpenClaw trusted-proxy 转发服务器。
 *
 * 服务器同时支持浏览器 Authorization Code + PKCE 会话和 API Bearer Token，对普通 HTTP 与
 * WebSocket Upgrade 使用同一认证边界。转发前会剥离客户端伪造的身份/Forwarded 头，再注入
 * 已验证用户、租户和来源信息；临近过期的会话使用按 session 单飞刷新，停止时排空在途请求
 * 并关闭全部升级连接。
 */
import * as http from "node:http";
import type { Duplex } from "node:stream";

import { OAuth2Client } from "./auth/oauth2-client.js";
import { extractBearerToken } from "./auth/request-auth.js";
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

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function connectionHeaderTokens(value: string | string[] | undefined): string[] {
  const source = Array.isArray(value) ? value.join(",") : value ?? "";
  return source
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
}

function proxyResponseHeaders(source: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const headers: http.OutgoingHttpHeaders = { ...source };
  for (const header of connectionHeaderTokens(source.connection)) delete headers[header];
  for (const header of HOP_BY_HOP_HEADERS) delete headers[header];
  return headers;
}

function parseScopeString(scope: string | undefined): string[] {
  return scope?.split(/\s+/).filter(Boolean) ?? [];
}

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

/** 清除不可信身份头，并构建 Gateway trusted-proxy 可消费的转发 Header。 */
export function buildOAuth2ForwardHeaders(
  source: http.IncomingHttpHeaders,
  context: AuthContext,
  remoteAddress: string | undefined,
  proxy: OAuth2ProxyConfig,
  transport: "http" | "upgrade" = "http",
): http.OutgoingHttpHeaders {
  const headers: http.OutgoingHttpHeaders = {};
  const configuredIdentityHeaders = new Set([
    proxy.userHeader.toLowerCase(),
    proxy.tenantHeader?.toLowerCase(),
  ]);
  for (const [name, value] of Object.entries(source)) {
    const lower = name.toLowerCase();
    if (
      lower === "authorization" ||
      STRIPPED_HEADERS.has(lower) ||
      configuredIdentityHeaders.has(lower) ||
      HOP_BY_HOP_HEADERS.has(lower)
    ) continue;
    headers[lower] = value;
  }
  for (const header of connectionHeaderTokens(source.connection)) delete headers[header];
  if (transport === "upgrade") {
    headers.connection = "Upgrade";
    if (source.upgrade) headers.upgrade = source.upgrade;
  }
  headers[proxy.userHeader.toLowerCase()] = context.loginId;
  headers["x-forwarded-for"] = remoteAddress ?? "unknown";
  headers["x-forwarded-proto"] = proxy.forwardedProto;
  if (source.host) headers["x-forwarded-host"] = source.host;
  if (proxy.tenantHeader && context.tenantId) headers[proxy.tenantHeader.toLowerCase()] = context.tenantId;
  return headers;
}

/** 管理 OAuth2 本地端点、请求认证、会话刷新及 Gateway 反向代理生命周期。 */
export class OAuth2ProxyServer {
  private server: http.Server | null = null;
  private readonly upgradedSockets = new Set<Duplex>();
  private readonly pendingRequests = new Set<Promise<void>>();
  private readonly oauthClient: OAuth2Client;
  private readonly sessions: OAuth2SessionStore;
  private readonly refreshes = new Map<string, Promise<AuthContext>>();

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
      const pending = this.handleHttp(request, response).catch((error) => {
        this.logger.error(`[openclaw-oauth2] request failed: ${error instanceof Error ? error.message : String(error)}`);
        if (!response.headersSent) response.writeHead(503, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        if (!response.writableEnded) response.end(JSON.stringify({ error: "oauth2_service_unavailable" }));
      }).finally(() => this.pendingRequests.delete(pending));
      this.pendingRequests.add(pending);
    });
    server.on("upgrade", (request, socket, head) => {
      const pending = this.handleUpgrade(request, socket, head).catch((error) => {
        this.logger.warn(`[openclaw-oauth2] upgrade authentication failed: ${error instanceof Error ? error.message : String(error)}`);
        if (!socket.destroyed) rejectUpgrade(socket, "OAuth2 service unavailable");
      }).finally(() => this.pendingRequests.delete(pending));
      this.pendingRequests.add(pending);
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
    await Promise.allSettled([...this.pendingRequests]);
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
      return this.createContext(user.userId, user.tenantId, scopes);
    }

    const session = await this.sessions.getSession(request.headers);
    if (!session) return null;
    if (session.tokens.expiresAt <= Date.now() + 30_000) {
      if (!session.tokens.refreshToken || (session.tokens.refreshExpiresAt ?? Number.POSITIVE_INFINITY) <= Date.now()) {
        return null;
      }
      let refresh = this.refreshes.get(session.id);
      if (!refresh) {
        refresh = (async () => {
          const refreshed = await this.oauthClient.refresh(session.tokens.refreshToken as string);
          const user = await this.oauthClient.resolveIdentity(refreshed);
          if (!user) throw new Error("refreshed OAuth2 access token is inactive");
          const effectiveScope = refreshed.scope ?? user.scope ?? session.tokens.scope;
          const context = this.createContext(
            user.userId,
            user.tenantId,
            parseScopeString(effectiveScope),
          );
          if (!context) throw new Error("refreshed OAuth2 token is missing required scopes");
          session.tokens = {
            ...refreshed,
            refreshToken: refreshed.refreshToken ?? session.tokens.refreshToken,
            refreshExpiresAt: refreshed.refreshExpiresAt ?? session.tokens.refreshExpiresAt,
            scope: effectiveScope,
          };
          session.context = context;
          await this.sessions.saveSession(session);
          return context;
        })().finally(() => this.refreshes.delete(session.id));
        this.refreshes.set(session.id, refresh);
      }
      return refresh;
    }
    return session.context;
  }

  private async serveLocalEndpoint(request: http.IncomingMessage, response: http.ServerResponse): Promise<boolean> {
    const path = pathnameOf(request.url);
    if (path === "/health") {
      if (request.method !== "GET" && request.method !== "HEAD") return this.methodNotAllowed(response, "GET, HEAD");
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(request.method === "HEAD" ? undefined : JSON.stringify({ ok: true, plugin: "openclaw-oauth2", ready: this.oauthClient.isReady() }));
      return true;
    }
    if (path === "/auth/oauth2/login") {
      if (request.method !== "GET") return this.methodNotAllowed(response, "GET");
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
      if (request.method !== "GET") return this.methodNotAllowed(response, "GET");
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
        const context = this.createContext(user.userId, user.tenantId, scopes);
        if (!context) throw new Error("OAuth2 token is missing required scopes");
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
      if (request.method !== "POST") return this.methodNotAllowed(response, "POST");
      const session = await this.sessions.deleteSession(request.headers);
      if (session) await this.oauthClient.revoke(session.tokens.accessToken).catch(() => undefined);
      response.writeHead(302, { location: "/", "set-cookie": this.sessions.clearCookie(), "cache-control": "no-store" });
      response.end();
      return true;
    }
    return false;
  }

  private methodNotAllowed(response: http.ServerResponse, allow: string): true {
    response.writeHead(405, { allow, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    response.end(JSON.stringify({ error: "method_not_allowed" }));
    return true;
  }

  private createContext(
    loginId: string,
    tenantId: string | undefined,
    scopes: string[],
  ): AuthContext | null {
    const granted = new Set(scopes);
    if (this.config.client.requiredScopes.some((scope) => !granted.has(scope))) return null;
    return { authenticated: true, loginId, tenantId, scopes };
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
      response.writeHead(upstreamResponse.statusCode ?? 502, proxyResponseHeaders(upstreamResponse.headers));
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
      headers: buildOAuth2ForwardHeaders(request.headers, context, request.socket.remoteAddress, proxy, "upgrade"),
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
