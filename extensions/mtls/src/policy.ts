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
    if (allowed.fingerprint && certificate.fingerprint !== allowed.fingerprint) return false;
    return true;
  });
}

export function authorizeMtlsRequest(
  config: MtlsConfig,
  pathname: string,
  certificate: ClientCertInfo | undefined,
): MtlsAuthorization {
  if (!isPathProtected(config, pathname)) {
    return { allowed: true, authenticated: Boolean(certificate?.verified) };
  }
  if (!certificate?.subject) {
    if (config.passthrough) return { allowed: true, authenticated: false };
    return {
      allowed: false,
      authenticated: false,
      statusCode: 401,
      message: "Client certificate required",
    };
  }
  if (config.tls.rejectUnauthorized && !certificate.verified) {
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

export function buildForwardHeaders(
  config: MtlsConfig,
  source: IncomingHttpHeaders,
  certificate: ClientCertInfo | undefined,
  remoteAddress: string | undefined,
): OutgoingHttpHeaders {
  const headers: OutgoingHttpHeaders = { ...source };
  const identityHeader = normalizeHeaderName(config.proxy.userHeader);
  const certificateHeader = normalizeHeaderName(config.headerName);

  delete headers[identityHeader];
  delete headers[certificateHeader];
  delete headers["x-forwarded-for"];
  delete headers["x-forwarded-proto"];
  delete headers["x-openclaw-scopes"];

  headers["x-forwarded-proto"] = "https";
  if (remoteAddress) headers["x-forwarded-for"] = remoteAddress;
  if (certificate?.subject) headers[identityHeader] = certificate.subject;
  if (config.proxy.scopesHeader) headers["x-openclaw-scopes"] = config.proxy.scopesHeader;

  if (certificate && config.headerCertField) {
    const value = certificate[config.headerCertField as keyof ClientCertInfo];
    if (typeof value === "string" && value) headers[certificateHeader] = value;
  }
  return headers;
}
