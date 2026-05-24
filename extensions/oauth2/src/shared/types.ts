/**
 * openclaw-oauth2 类型定义
 * 深度整合 Sa-Token OAuth2 的类型
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
  /** 认证提供商类型 */
  provider: "sa-token" | "keycloak" | "auth0" | "azure-ad" | "generic";
  /** OIDC Issuer URL（Sa-Token SCRM 后端地址） */
  issuerUrl: string;
  /** OAuth2 Client ID */
  clientId: string;
  /** OAuth2 Client Secret（仅 introspection 使用） */
  clientSecret?: string;
  /** Token 受众标识 */
  audience?: string;
  /** Token 验证策略 */
  tokenFormat: "jwt-prefer" | "jwt-only" | "introspection-only";
  /** Scope → OpenClaw Role 映射 */
  scopeMapping: Record<string, string>;
  /** JWKS 缓存 TTL（秒） */
  jwksCacheTtl: number;
  /** Introspection 结果缓存 TTL（秒） */
  introspectionCacheTtl: number;
  /** 不需要认证的路径 */
  skipPaths: string[];
  /** Sa-Token 特有配置 */
  satoken: {
    loginIdClaim: string;
    tenantIdClaim: string;
    loginTypeClaim: string;
  };
  /** 向后兼容：Gateway Token（开发模式） */
  gatewayToken?: string;
}

// ─────────────────── OIDC Discovery ───────────────────

/** OIDC Discovery 配置 */
export interface OidcConfig {
  issuer: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  introspection_endpoint?: string;
  jwks_uri: string;
  scopes_supported?: string[];
  grant_types_supported?: string[];
  response_types_supported?: string[];
  token_endpoint_auth_methods_supported?: string[];
  code_challenge_methods_supported?: string[];
}

// ─────────────────── JWT ───────────────────

/** JWK（JSON Web Key）公钥 */
export interface JWK {
  kty: string;
  kid?: string;
  use?: string;
  alg?: string;
  n?: string;
  e?: string;
  x?: string;
  y?: string;
  crv?: string;
}

/** JWKS（JSON Web Key Set） */
export interface JWKS {
  keys: JWK[];
}

/** Sa-Token JWT Claims */
export interface SaTokenClaims {
  /** Sa-Token 用户标识 */
  loginId: string | number;
  /** Sa-Token 登录类型 */
  loginType?: string;
  /** 租户标识（SaaS 扩展） */
  tenantId?: string;
  /** 权限范围（空格分隔） */
  scope?: string;
  /** 过期时间（Unix 秒） */
  exp: number;
  /** 签发者 */
  iss?: string;
  /** 受众 */
  aud?: string | string[];
  /** 签发时间 */
  iat?: number;
  /** Client ID */
  client_id?: string;
}

/** JWT 验证错误类型 */
export type JwtErrorCode =
  | "TOKEN_EXPIRED"
  | "INVALID_SIGNATURE"
  | "KID_NOT_FOUND"
  | "INVALID_ISSUER"
  | "INVALID_AUDIENCE"
  | "MALFORMED_TOKEN"
  | "JWKS_FETCH_FAILED";

/** JWT 验证错误 */
export class JwtError extends Error {
  constructor(
    message: string,
    public readonly code: JwtErrorCode
  ) {
    super(message);
    this.name = "JwtError";
  }
}

// ─────────────────── Introspection ───────────────────

/** Token Introspection 响应 */
export interface IntrospectionResult {
  active: boolean;
  scope?: string;
  loginId?: string;
  tenantId?: string;
  client_id?: string;
  exp?: number;
}

// ─────────────────── Auth Context ───────────────────

/** 用户角色 */
export type Role = "viewer" | "operator" | "admin";

/** 权限类型 */
export type Permission = "read" | "write" | "admin";

/** 认证上下文（注入到请求对象） */
export interface AuthContext {
  authenticated: boolean;
  role: Role;
  permissions: Permission[];
  /** Sa-Token 用户标识 */
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
