/**
 * @fileoverview openclaw-oauth2 标准 OAuth2/OIDC 客户端与认证上下文类型。
 *
 * @module oauth2/shared/types
 */

import type { IncomingMessage, ServerResponse } from "node:http";

// ─────────────────── Plugin API ───────────────────

/** OpenClaw 插件 API */
export interface PluginApi {
  runtime: GatewayRuntime;
  registerHttpRoute(route: HttpRouteDefinition): void;
}

export interface HttpRouteDefinition {
  path: string;
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void;
}

export interface GatewayRuntime {
  config: Record<string, unknown>;
}

// ─────────────────── Auth 配置 ───────────────────

/** OAuth2 插件完整配置 */
export interface AuthOAuth2Config {
  /** 是否启动 OAuth2 授权代理 */
  enabled?: boolean;
  /** OAuth2/OIDC Issuer URL */
  issuerUrl: string;
  /** OAuth2 Client ID */
  clientId: string;
  /** OAuth2 Client Secret */
  clientSecret?: string;
  /** Resource Server 反向代理配置 */
  proxy: OAuth2ProxyConfig;
  /** OAuth2 Authorization Code Client 配置 */
  client: OAuth2ClientConfig;
}

export interface OAuth2ProxyConfig {
  listenHost: string;
  listenPort: number;
  upstreamHost: string;
  upstreamPort: number;
  requestTimeoutMs: number;
  userHeader: string;
  tenantHeader?: string;
  forwardedProto: "http" | "https";
}

export interface OAuth2ClientConfig {
  discovery: boolean;
  redirectUri: string;
  scopes: string[];
  requiredScopes: string[];
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  revokeEndpoint?: string;
  userInfoEndpoint?: string;
  introspectionEndpoint?: string;
  clientAuthMethod: "client_secret_post" | "client_secret_basic" | "none";
  authorizationParameters: Record<string, string>;
  tokenParameters: Record<string, string>;
  requestTimeoutMs: number;
  successRedirect: string;
  sessionSecret: string;
  sessionCookieName: string;
  sessionTtlSeconds: number;
  stateTtlSeconds: number;
  secureCookies: boolean;
  userIdField: string;
  tenantIdField?: string;
  unauthorizedMode: "auto" | "redirect" | "unauthorized";
  sessionStore: OAuth2SessionStoreConfig;
}

export interface OAuth2SessionStoreConfig {
  type: "memory" | "redis";
  redisUrl?: string;
  keyPrefix: string;
  maxEntries: number;
}

export interface OAuth2TokenSet {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresAt: number;
  refreshExpiresAt?: number;
  scope?: string;
  identityClaims?: Record<string, unknown>;
}

export interface OAuth2UserInfo {
  userId: string;
  tenantId?: string;
  scope?: string;
  raw: Record<string, unknown>;
}

// ─────────────────── Auth Context ───────────────────

/** 认证上下文（注入到请求对象） */
export interface AuthContext {
  authenticated: boolean;
  /** OAuth2/OIDC 用户标识 */
  loginId?: string;
  /** 租户标识 */
  tenantId?: string;
  /** 登录类型 */
  loginType?: string;
  /** 原始 scope 列表 */
  scopes?: string[];
}

/** 扩展请求类型 */
export interface AuthenticatedRequest extends IncomingMessage {
  authContext?: AuthContext;
}
