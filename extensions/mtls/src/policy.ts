import type { IncomingHttpHeaders, OutgoingHttpHeaders } from "node:http";

import type { ClientCertInfo, MtlsConfig } from "./shared/types.js";

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
