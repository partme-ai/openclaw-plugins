/**
 * @fileoverview OAuth2 Client 授权代理的配置合并与安全校验。
 *
 * 配置覆盖外部发行者/端点、客户端认证、PKCE 回调、Scope、会话存储和本地反向代理。启用
 * 时强制上游为本机 OpenClaw Gateway，并核对 trusted-proxy 身份 Header；生产回调和发行者
 * 默认要求 HTTPS，仅允许显式受控的本地开发例外。
 */
import type { AuthOAuth2Config, OAuth2ClientConfig, OAuth2ProxyConfig } from "./shared/types.js";

export type OAuth2ConfigInput = Partial<Omit<AuthOAuth2Config, "proxy" | "client">> & {
  proxy?: Partial<OAuth2ProxyConfig>;
  client?: Partial<Omit<OAuth2ClientConfig, "sessionStore">> & {
    sessionStore?: Partial<OAuth2ClientConfig["sessionStore"]>;
  };
};

export type OpenClawGatewayConfigSlice = {
  gateway?: {
    port?: number;
    trustedProxies?: string[];
    auth?: {
      mode?: string;
      trustedProxy?: {
        userHeader?: string;
        allowLoopback?: boolean;
      };
    };
  };
};

const DEFAULT_PROXY: OAuth2ProxyConfig = {
  listenHost: "0.0.0.0",
  listenPort: 18080,
  upstreamHost: "127.0.0.1",
  upstreamPort: 18789,
  requestTimeoutMs: 30_000,
  userHeader: "x-forwarded-user",
  tenantHeader: "x-openclaw-tenant",
  forwardedProto: "https",
};

const DEFAULT_CLIENT: OAuth2ClientConfig = {
  discovery: true,
  redirectUri: "",
  scopes: ["openid", "profile"],
  requiredScopes: [],
  successRedirect: "/",
  sessionSecret: "",
  sessionCookieName: "openclaw_oauth2_session",
  sessionTtlSeconds: 8 * 60 * 60,
  stateTtlSeconds: 5 * 60,
  secureCookies: true,
  userIdField: "sub",
  tenantIdField: "tenantId",
  unauthorizedMode: "auto",
  clientAuthMethod: "client_secret_post",
  authorizationParameters: {},
  tokenParameters: {},
  requestTimeoutMs: 5_000,
  sessionStore: { type: "memory", keyPrefix: "openclaw:oauth2", maxEntries: 10_000 },
};

const DEFAULT_CONFIG: AuthOAuth2Config = {
  enabled: false,
  issuerUrl: "",
  clientId: "openclaw-gateway",
  proxy: DEFAULT_PROXY,
  client: DEFAULT_CLIENT,
};

function requirePort(value: number, field: string, allowEphemeral = false): void {
  const minimum = allowEphemeral ? 0 : 1;
  if (!Number.isInteger(value) || value < minimum || value > 65535) {
    throw new Error(`[openclaw-oauth2] ${field} must be an integer between ${minimum} and 65535`);
  }
}

function requireLoopbackUpstream(host: string): "127.0.0.1" | "::1" {
  const normalized = host.trim().toLowerCase();
  if (normalized === "127.0.0.1" || normalized === "::1") return normalized;
  throw new Error(
    "[openclaw-oauth2] proxy.upstreamHost must be 127.0.0.1 or ::1; the plugin may only proxy to its local OpenClaw Gateway",
  );
}

const HTTP_HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const RESERVED_IDENTITY_HEADERS = new Set([
  "authorization",
  "connection",
  "cookie",
  "forwarded",
  "host",
  "proxy-authorization",
  "transfer-encoding",
  "upgrade",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-real-ip",
]);

function requireIdentityHeader(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!HTTP_HEADER_NAME.test(normalized)) {
    throw new Error(`[openclaw-oauth2] ${field} must be a valid HTTP header name`);
  }
  if (RESERVED_IDENTITY_HEADERS.has(normalized)) {
    throw new Error(`[openclaw-oauth2] ${field} cannot use reserved header ${normalized}`);
  }
  return normalized;
}

export function resolveOAuth2Config(input: OAuth2ConfigInput | undefined): AuthOAuth2Config {
  const config: AuthOAuth2Config = {
    ...DEFAULT_CONFIG,
    ...input,
    proxy: { ...DEFAULT_PROXY, ...input?.proxy },
    client: {
      ...DEFAULT_CLIENT,
      ...input?.client,
      scopes: input?.client?.scopes ?? DEFAULT_CLIENT.scopes,
      requiredScopes: input?.client?.requiredScopes ?? DEFAULT_CLIENT.requiredScopes,
      authorizationParameters: {
        ...DEFAULT_CLIENT.authorizationParameters,
        ...input?.client?.authorizationParameters,
      },
      tokenParameters: {
        ...DEFAULT_CLIENT.tokenParameters,
        ...input?.client?.tokenParameters,
      },
      sessionStore: { ...DEFAULT_CLIENT.sessionStore, ...input?.client?.sessionStore },
    },
  };

  const proxy = config.proxy as OAuth2ProxyConfig;
  requirePort(proxy.listenPort, "proxy.listenPort", true);
  requirePort(proxy.upstreamPort, "proxy.upstreamPort");
  if (proxy.requestTimeoutMs < 1_000) {
    throw new Error("[openclaw-oauth2] proxy.requestTimeoutMs must be at least 1000ms");
  }
  proxy.userHeader = requireIdentityHeader(proxy.userHeader, "proxy.userHeader");
  if (proxy.tenantHeader) {
    proxy.tenantHeader = requireIdentityHeader(proxy.tenantHeader, "proxy.tenantHeader");
    if (proxy.tenantHeader === proxy.userHeader) {
      throw new Error("[openclaw-oauth2] proxy.tenantHeader and proxy.userHeader must be different");
    }
  }
  if (proxy.forwardedProto !== "http" && proxy.forwardedProto !== "https") {
    throw new Error("[openclaw-oauth2] proxy.forwardedProto must be http or https");
  }
  if (!Number.isSafeInteger(config.client.sessionStore.maxEntries) || config.client.sessionStore.maxEntries < 1) {
    throw new Error("[openclaw-oauth2] client.sessionStore.maxEntries must be a positive safe integer");
  }
  if (config.client.requiredScopes.some((scope) => !scope.trim() || /\s/.test(scope))) {
    throw new Error("[openclaw-oauth2] client.requiredScopes entries must be non-empty scope tokens");
  }

  if (config.enabled) {
    proxy.upstreamHost = requireLoopbackUpstream(proxy.upstreamHost);
    if (!config.issuerUrl.trim()) throw new Error("[openclaw-oauth2] issuerUrl is required when enabled");
    const issuer = new URL(config.issuerUrl);
    const loopback = issuer.hostname === "localhost" || issuer.hostname === "127.0.0.1" || issuer.hostname === "::1";
    if (issuer.protocol !== "https:" && !loopback) {
      throw new Error("[openclaw-oauth2] issuerUrl must use HTTPS outside loopback development");
    }
    if (config.client?.clientAuthMethod !== "none" && !config.clientSecret) {
      throw new Error("[openclaw-oauth2] clientSecret is required for the OAuth2 client flow");
    }
    if (!config.client?.redirectUri.trim()) {
      throw new Error("[openclaw-oauth2] client.redirectUri is required when enabled");
    }
    if (!config.client.sessionSecret || config.client.sessionSecret.length < 32) {
      throw new Error("[openclaw-oauth2] client.sessionSecret must contain at least 32 characters");
    }
    if (config.client.sessionStore.type === "redis" && !config.client.sessionStore.redisUrl?.trim()) {
      throw new Error("[openclaw-oauth2] client.sessionStore.redisUrl is required for Redis sessions");
    }
    if (!config.client.discovery && (!config.client.authorizationEndpoint || !config.client.tokenEndpoint)) {
      throw new Error("[openclaw-oauth2] explicit authorizationEndpoint and tokenEndpoint are required when discovery=false");
    }
    if (config.client.requestTimeoutMs < 1_000) {
      throw new Error("[openclaw-oauth2] client.requestTimeoutMs must be at least 1000ms");
    }
    assertNoReservedParameters(
      config.client.authorizationParameters,
      ["client_id", "response_type", "redirect_uri", "scope", "state", "code_challenge", "code_challenge_method"],
      "client.authorizationParameters",
    );
    assertNoReservedParameters(
      config.client.tokenParameters,
      ["client_id", "client_secret", "grant_type", "code", "redirect_uri", "code_verifier", "refresh_token"],
      "client.tokenParameters",
    );
    for (const [field, value] of Object.entries({
      authorizationEndpoint: config.client.authorizationEndpoint,
      tokenEndpoint: config.client.tokenEndpoint,
      userInfoEndpoint: config.client.userInfoEndpoint,
      introspectionEndpoint: config.client.introspectionEndpoint,
      revokeEndpoint: config.client.revokeEndpoint,
    })) {
      if (!value) continue;
      const endpoint = new URL(value);
      const endpointLoopback = endpoint.hostname === "localhost" || endpoint.hostname === "127.0.0.1" || endpoint.hostname === "::1";
      if (endpoint.protocol !== "https:" && !endpointLoopback) {
        throw new Error(`[openclaw-oauth2] client.${field} must use HTTPS outside loopback development`);
      }
    }
  }

  return config;
}

/**
 * Fail closed unless the local OpenClaw Gateway is configured to trust exactly
 * the identity header emitted by this OAuth2 proxy.
 */
export function validateOAuth2GatewayIntegration(
  config: AuthOAuth2Config,
  openClawConfig: OpenClawGatewayConfigSlice,
): void {
  if (!config.enabled) return;

  const gateway = openClawConfig.gateway;
  const auth = gateway?.auth;
  if (auth?.mode !== "trusted-proxy") {
    throw new Error(
      "[openclaw-oauth2] gateway.auth.mode must be trusted-proxy when the OAuth2 proxy is enabled",
    );
  }

  const configuredHeader = auth.trustedProxy?.userHeader?.trim().toLowerCase();
  if (configuredHeader !== config.proxy.userHeader) {
    throw new Error(
      `[openclaw-oauth2] gateway.auth.trustedProxy.userHeader must equal ${config.proxy.userHeader}`,
    );
  }
  if (auth.trustedProxy?.allowLoopback !== true) {
    throw new Error(
      "[openclaw-oauth2] gateway.auth.trustedProxy.allowLoopback must be true for the local OAuth2 proxy",
    );
  }

  const trustedProxies = gateway?.trustedProxies?.map((value) => value.trim()) ?? [];
  if (!trustedProxies.includes(config.proxy.upstreamHost)) {
    throw new Error(
      `[openclaw-oauth2] gateway.trustedProxies must include ${config.proxy.upstreamHost}`,
    );
  }

  const gatewayPort = gateway?.port ?? 18789;
  if (gatewayPort !== config.proxy.upstreamPort) {
    throw new Error(
      `[openclaw-oauth2] proxy.upstreamPort (${config.proxy.upstreamPort}) must match gateway.port (${gatewayPort})`,
    );
  }
}

function assertNoReservedParameters(
  parameters: Record<string, string>,
  reserved: string[],
  field: string,
): void {
  const invalid = reserved.find((name) => Object.hasOwn(parameters, name));
  if (invalid) {
    throw new Error(`[openclaw-oauth2] ${field}.${invalid} is managed by openid-client and cannot be overridden`);
  }
}
