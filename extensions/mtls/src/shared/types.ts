/**
 * @fileoverview mTLS 插件核心类型（配置、证书信息、认证上下文、状态快照）。
 *
 * @module mtls/shared/types
 */

/** TLS 服务端/双向认证相关配置。 */
export interface MtlsTlsConfig {
  enabled: boolean;
  certFile: string;
  keyFile: string;
  caFile: string;
  requestCert: boolean;
  rejectUnauthorized: boolean;
}

/** 单条受保护路径规则（exact 或 prefix 匹配）。 */
export interface MtlsPathRule {
  path: string;
  match: "exact" | "prefix";
  allowUnauthenticated: boolean;
}

/** 客户端证书白名单项（CN / issuer / fingerprint 可选组合）。 */
export interface MtlsAllowedClient {
  cn?: string;
  issuer?: string;
  fingerprint?: string;
}

/** mTLS 插件完整运行时配置（来自 `openclaw.json` 的 `mtls` 段）。 */
export interface MtlsConfig {
  enabled: boolean;
  tls: MtlsTlsConfig;
  protectedPaths: MtlsPathRule[];
  allowedClients: MtlsAllowedClient[];
  skipPaths: string[];
  passthrough: boolean;
  headerName: string;
  headerCertField: string;
}

/** 从 TLS 对端证书解析出的字段摘要。 */
export interface ClientCertInfo {
  subject?: string;
  issuer?: string;
  fingerprint?: string;
  serialNumber?: string;
  notBefore?: string;
  notAfter?: string;
  verified: boolean;
}

/** 注入 HTTP 请求的 mTLS 认证上下文（method 固定为 `mtls`）。 */
export interface MtlsAuthContext {
  authenticated: boolean;
  clientCert?: ClientCertInfo;
  principal?: string;
  method: "mtls";
  timestamp: string;
}

/** `/mtls/status` 与中间件共享的请求统计快照。 */
export interface MtlsStatusSnapshot {
  totalRequests: number;
  authenticatedRequests: number;
  rejectedRequests: number;
  passthroughRequests: number;
  activeSessions: number;
}

/** 状态端点返回的特性开关摘要。 */
export interface MtlsFeatures {
  bidirectionalAuth: boolean;
  whitelistControl: boolean;
  pathProtection: boolean;
  passthroughMode: boolean;
  headerPropagation: boolean;
}
