/**
 * mTLS 安全鉴权插件核心类型定义
 */

export interface MtlsTlsConfig {
  enabled: boolean;
  certFile: string;
  keyFile: string;
  caFile: string;
  requestCert: boolean;
  rejectUnauthorized: boolean;
}

export interface MtlsPathRule {
  path: string;
  match: "exact" | "prefix";
  allowUnauthenticated: boolean;
}

export interface MtlsAllowedClient {
  cn?: string;
  issuer?: string;
  fingerprint?: string;
}

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

export interface ClientCertInfo {
  subject?: string;
  issuer?: string;
  fingerprint?: string;
  serialNumber?: string;
  notBefore?: string;
  notAfter?: string;
  verified: boolean;
}

export interface MtlsAuthContext {
  authenticated: boolean;
  clientCert?: ClientCertInfo;
  principal?: string;
  method: "mtls";
  timestamp: string;
}

export interface MtlsStatusSnapshot {
  totalRequests: number;
  authenticatedRequests: number;
  rejectedRequests: number;
  passthroughRequests: number;
  activeSessions: number;
}

export interface MtlsFeatures {
  bidirectionalAuth: boolean;
  whitelistControl: boolean;
  pathProtection: boolean;
  passthroughMode: boolean;
  headerPropagation: boolean;
}
