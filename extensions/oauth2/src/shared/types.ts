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

/** 旧式宿主适配层使用的最小 HTTP Route 描述；OAuth2 认证本身由前置代理完成。 */
export interface HttpRouteDefinition {
  path: string;
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void;
}

/** 旧式插件 API 暴露的最小 Gateway 运行时配置视图。 */
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

/**
 * OAuth2 认证前置代理的监听与本机 Gateway 转发配置。
 *
 * `upstreamHost` 运行时被限制为回环地址，身份 Header 只能由完成认证的代理重建。
 */
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

/**
 * 外部 OAuth2/OIDC 服务的标准 Client 配置。
 *
 * 可选择 Discovery 或显式端点，浏览器登录固定使用 Authorization Code + PKCE；附加参数不能
 * 覆盖 state、code_verifier 等由 `openid-client` 管理的安全字段。
 */
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

/** 登录会话与一次性授权 state 的存储后端配置；多实例部署应使用 Redis。 */
export interface OAuth2SessionStoreConfig {
  type: "memory" | "redis";
  redisUrl?: string;
  keyPrefix: string;
  maxEntries: number;
}

/**
 * 从 `openid-client` Token Endpoint 响应归一化后的令牌集合。
 *
 * 绝对失效时间用于代理提前刷新；该对象只保存在服务端会话存储，不写入浏览器 Cookie。
 */
export interface OAuth2TokenSet {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresAt: number;
  refreshExpiresAt?: number;
  scope?: string;
  identityClaims?: Record<string, unknown>;
}

/** 已从 ID Token、UserInfo 或 Introspection 声明中映射出的可信外部用户身份。 */
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
