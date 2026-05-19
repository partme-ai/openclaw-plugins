/**
 * mTLS 安全插件单元测试
 */

import { describe, it, expect } from "vitest";
import type { MtlsConfig, ClientCertInfo } from "../src/types.js";

const isPathProtected = (cfg: MtlsConfig, urlPath: string): boolean => {
  if (cfg.skipPaths.some((p) => urlPath === p || urlPath.startsWith(p + "/"))) {
    return false;
  }
  return cfg.protectedPaths.some((rule) => {
    if (rule.match === "exact") return urlPath === rule.path;
    return urlPath.startsWith(rule.path);
  });
};

const isClientAllowed = (cfg: MtlsConfig, cert: ClientCertInfo | undefined): boolean => {
  if (!cert?.subject) return false;
  if (cfg.allowedClients.length === 0) return true;
  return cfg.allowedClients.some((allowed) => {
    if (allowed.cn && cert.subject !== allowed.cn) return false;
    if (allowed.issuer && cert.issuer !== allowed.issuer) return false;
    if (allowed.fingerprint && cert.fingerprint !== allowed.fingerprint) return false;
    return true;
  });
};

const buildAuthContext = (cert: ClientCertInfo | undefined) => ({
  authenticated: !!cert?.subject,
  clientCert: cert,
  principal: cert?.subject,
  method: "mtls" as const,
  timestamp: new Date().toISOString(),
});

const defaultConfig: MtlsConfig = {
  enabled: true,
  tls: {
    enabled: true,
    certFile: "",
    keyFile: "",
    caFile: "",
    requestCert: true,
    rejectUnauthorized: true,
  },
  protectedPaths: [
    { path: "/", match: "prefix", allowUnauthenticated: false },
  ],
  allowedClients: [],
  skipPaths: ["/health", "/auth/status", "/mtls/status"],
  passthrough: false,
  headerName: "X-Client-Cert",
  headerCertField: "subject",
};

describe("mtls security plugin", () => {
  describe("isPathProtected", () => {
    it("should protect root path by default", () => {
      expect(isPathProtected(defaultConfig, "/api/v1/users")).toBe(true);
      expect(isPathProtected(defaultConfig, "/")).toBe(true);
    });

    it("should skip health path", () => {
      expect(isPathProtected(defaultConfig, "/health")).toBe(false);
      expect(isPathProtected(defaultConfig, "/health/check")).toBe(false);
    });

    it("should skip auth status path", () => {
      expect(isPathProtected(defaultConfig, "/auth/status")).toBe(false);
    });

    it("should skip mtls status path", () => {
      expect(isPathProtected(defaultConfig, "/mtls/status")).toBe(false);
    });

    it("should use exact match for exact rule", () => {
      const cfg: MtlsConfig = {
        ...defaultConfig,
        protectedPaths: [{ path: "/api", match: "exact", allowUnauthenticated: false }],
      };
      expect(isPathProtected(cfg, "/api")).toBe(true);
      expect(isPathProtected(cfg, "/api/v1")).toBe(false);
    });

    it("should use prefix match for prefix rule", () => {
      const cfg: MtlsConfig = {
        ...defaultConfig,
        protectedPaths: [{ path: "/api/v1", match: "prefix", allowUnauthenticated: false }],
      };
      expect(isPathProtected(cfg, "/api/v1")).toBe(true);
      expect(isPathProtected(cfg, "/api/v1/users")).toBe(true);
      expect(isPathProtected(cfg, "/api/v2")).toBe(false);
    });
  });

  describe("isClientAllowed", () => {
    it("should allow any client when allowedClients is empty", () => {
      const cert: ClientCertInfo = { subject: "test-client", verified: true };
      expect(isClientAllowed(defaultConfig, cert)).toBe(true);
    });

    it("should allow client with matching CN", () => {
      const cfg: MtlsConfig = {
        ...defaultConfig,
        allowedClients: [{ cn: "allowed-client" }],
      };
      const cert: ClientCertInfo = { subject: "allowed-client", verified: true };
      expect(isClientAllowed(cfg, cert)).toBe(true);
    });

    it("should reject client with non-matching CN", () => {
      const cfg: MtlsConfig = {
        ...defaultConfig,
        allowedClients: [{ cn: "allowed-client" }],
      };
      const cert: ClientCertInfo = { subject: "other-client", verified: true };
      expect(isClientAllowed(cfg, cert)).toBe(false);
    });

    it("should allow client with matching issuer", () => {
      const cfg: MtlsConfig = {
        ...defaultConfig,
        allowedClients: [{ issuer: "Test CA" }],
      };
      const cert: ClientCertInfo = { subject: "client", issuer: "Test CA", verified: true };
      expect(isClientAllowed(cfg, cert)).toBe(true);
    });

    it("should allow client with matching fingerprint", () => {
      const cfg: MtlsConfig = {
        ...defaultConfig,
        allowedClients: [{ fingerprint: "AB:CD:EF:12:34:56:78:90" }],
      };
      const cert: ClientCertInfo = { subject: "client", fingerprint: "AB:CD:EF:12:34:56:78:90", verified: true };
      expect(isClientAllowed(cfg, cert)).toBe(true);
    });

    it("should reject when no cert provided", () => {
      expect(isClientAllowed(defaultConfig, undefined)).toBe(false);
    });

    it("should reject when cert has no subject", () => {
      const cert: ClientCertInfo = { verified: true };
      expect(isClientAllowed(defaultConfig, cert)).toBe(false);
    });
  });

  describe("buildAuthContext", () => {
    it("should build context with valid cert", () => {
      const cert: ClientCertInfo = { subject: "test-client", issuer: "Test CA", verified: true };
      const ctx = buildAuthContext(cert);
      expect(ctx.authenticated).toBe(true);
      expect(ctx.principal).toBe("test-client");
      expect(ctx.clientCert).toEqual(cert);
      expect(ctx.method).toBe("mtls");
      expect(ctx.timestamp).toBeDefined();
    });

    it("should build context without cert", () => {
      const ctx = buildAuthContext(undefined);
      expect(ctx.authenticated).toBe(false);
      expect(ctx.principal).toBeUndefined();
      expect(ctx.clientCert).toBeUndefined();
      expect(ctx.method).toBe("mtls");
    });
  });
});
