import type { AuthOAuth2Config, OAuth2ClientConfig, OAuth2ProxyConfig } from "./shared/types.js";

export type OAuth2ConfigInput = Partial<Omit<AuthOAuth2Config, "proxy" | "client">> & {
  proxy?: Partial<OAuth2ProxyConfig>;
  client?: Partial<OAuth2ClientConfig>;
};

const DEFAULT_PROXY: OAuth2ProxyConfig = {
  listenHost: "0.0.0.0",
  listenPort: 18080,
  upstreamHost: "127.0.0.1",
  upstreamPort: 18789,
  requestTimeoutMs: 30_000,
  userHeader: "x-forwarded-user",
  tenantHeader: "x-openclaw-tenant",
};

const DEFAULT_CLIENT: OAuth2ClientConfig = {
  discovery: true,
  redirectUri: "",
  scopes: ["openid", "profile"],
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
  sessionStore: { type: "memory", keyPrefix: "openclaw:oauth2" },
};

const DEFAULT_CONFIG: AuthOAuth2Config = {
  enabled: false,
  issuerUrl: "",
  clientId: "openclaw-gateway",
  scopeMapping: {
    "openclaw:admin": "admin",
    "openclaw:operator": "operator",
    "openclaw:viewer": "viewer",
  },
  proxy: DEFAULT_PROXY,
  client: DEFAULT_CLIENT,
};

function requirePort(value: number, field: string, allowEphemeral = false): void {
  const minimum = allowEphemeral ? 0 : 1;
  if (!Number.isInteger(value) || value < minimum || value > 65535) {
    throw new Error(`[openclaw-oauth2] ${field} must be an integer between ${minimum} and 65535`);
  }
}

export function resolveOAuth2Config(input: OAuth2ConfigInput | undefined): AuthOAuth2Config {
  const config: AuthOAuth2Config = {
    ...DEFAULT_CONFIG,
    ...input,
    scopeMapping: { ...DEFAULT_CONFIG.scopeMapping, ...input?.scopeMapping },
    proxy: { ...DEFAULT_PROXY, ...input?.proxy },
    client: {
      ...DEFAULT_CLIENT,
      ...input?.client,
      scopes: input?.client?.scopes ?? DEFAULT_CLIENT.scopes,
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
  if (!proxy.userHeader.trim()) {
    throw new Error("[openclaw-oauth2] proxy.userHeader is required");
  }

  if (config.enabled) {
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
