/**
 * @fileoverview mTLS 请求授权策略与可信转发 Header 构造。
 *
 * 授权先按路径判断是否强制证书，再校验证书链结果及 CN/颁发者/指纹白名单。转发前会删除
 * 客户端伪造的身份头、Forwarded/X-Forwarded-* 和 hop-by-hop 头，只由代理重新注入已经
 * 验证的主体身份，防止 trusted-proxy 身份欺骗。
 */
import type { IncomingHttpHeaders, OutgoingHttpHeaders } from "node:http";

import type { ClientCertInfo, MtlsConfig } from "./shared/types.js";

/**
 * 单次 HTTP 或 WebSocket Upgrade 请求的证书授权判定。
 *
 * `allowed` 表示请求能否继续转发；允许转发不等于已经认证，因为公开路径可以在没有证书时
 * 匿名通过。只有 `authenticated` 为 true 时，`principal` 和证书信息才可作为可信身份注入。
 * 拒绝结果携带可直接返回客户端的 401/403 状态，但不会暴露证书内部细节。
 */
export type MtlsAuthorization =
  | {
      allowed: true;
      authenticated: boolean;
      principal?: string;
      certificate?: ClientCertInfo;
    }
  | {
      allowed: false;
      authenticated: false;
      statusCode: 401 | 403;
      message: string;
    };

function pathMatches(pathname: string, path: string, match: "exact" | "prefix"): boolean {
  if (match === "exact") return pathname === path;
  if (path === "/") return pathname.startsWith("/");
  return pathname === path || pathname.startsWith(`${path}/`);
}

/** 判断请求路径是否必须通过客户端证书认证。 */
export function isPathProtected(config: MtlsConfig, pathname: string): boolean {
  if (config.skipPaths.some((path) => pathMatches(pathname, path, "prefix"))) {
    return false;
  }
  const rule = config.protectedPaths.find((candidate) =>
    pathMatches(pathname, candidate.path, candidate.match),
  );
  return Boolean(rule && !rule.allowUnauthenticated);
}

function isClientAllowed(config: MtlsConfig, certificate: ClientCertInfo): boolean {
  if (!certificate.subject) return false;
  if (config.allowedClients.length === 0) return true;
  return config.allowedClients.some((allowed) => {
    if (allowed.cn && certificate.subject !== allowed.cn) return false;
    if (allowed.issuer && certificate.issuer !== allowed.issuer) return false;
    if (
      allowed.fingerprint &&
      certificate.fingerprint?.toLowerCase() !== allowed.fingerprint.toLowerCase()
    ) return false;
    return true;
  });
}

/** 根据路径策略和证书信息返回可审计的授权结果。 */
export function authorizeMtlsRequest(
  config: MtlsConfig,
  pathname: string,
  certificate: ClientCertInfo | undefined,
): MtlsAuthorization {
  if (!isPathProtected(config, pathname)) {
    if (certificate?.verified && isClientAllowed(config, certificate)) {
      return {
        allowed: true,
        authenticated: true,
        principal: certificate.subject,
        certificate,
      };
    }
    return { allowed: true, authenticated: false };
  }
  if (!certificate?.subject) {
    return {
      allowed: false,
      authenticated: false,
      statusCode: 401,
      message: "Client certificate required",
    };
  }
  if (!certificate.verified) {
    return {
      allowed: false,
      authenticated: false,
      statusCode: 401,
      message: "Client certificate verification failed",
    };
  }
  if (!isClientAllowed(config, certificate)) {
    return {
      allowed: false,
      authenticated: false,
      statusCode: 403,
      message: "Client certificate not allowed",
    };
  }
  return {
    allowed: true,
    authenticated: true,
    principal: certificate.subject,
    certificate,
  };
}

function normalizeHeaderName(value: string): string {
  return value.trim().toLowerCase();
}

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

/** 清除不可信转发头，并根据已验证证书重建 Gateway 可信任的身份 Header。 */
export function buildForwardHeaders(
  config: MtlsConfig,
  source: IncomingHttpHeaders,
  certificate: ClientCertInfo | undefined,
  remoteAddress: string | undefined,
  transport: "http" | "upgrade" = "http",
): OutgoingHttpHeaders {
  const headers: OutgoingHttpHeaders = { ...source };
  const identityHeader = normalizeHeaderName(config.proxy.userHeader);
  const certificateHeader = normalizeHeaderName(config.headerName);

  delete headers[identityHeader];
  delete headers[certificateHeader];
  delete headers.forwarded;
  delete headers["x-real-ip"];
  for (const header of connectionHeaderTokens(source.connection)) delete headers[header];
  for (const header of HOP_BY_HOP_HEADERS) delete headers[header];
  for (const header of Object.keys(headers)) {
    if (header.toLowerCase().startsWith("x-forwarded-")) delete headers[header];
  }

  if (transport === "upgrade") {
    headers.connection = "Upgrade";
    if (source.upgrade) headers.upgrade = source.upgrade;
  }

  headers["x-forwarded-proto"] = "https";
  if (remoteAddress) headers["x-forwarded-for"] = remoteAddress;
  if (source.host) headers["x-forwarded-host"] = source.host;
  if (certificate?.subject) headers[identityHeader] = certificate.subject;

  if (certificate && config.headerCertField) {
    const value = certificate[config.headerCertField as keyof ClientCertInfo];
    if (typeof value === "string" && value) headers[certificateHeader] = value;
  }
  return headers;
}
