import { describe, expect, it } from "vitest";

import {
  authorizeMtlsRequest,
  buildForwardHeaders,
  isPathProtected,
} from "../src/policy.js";
import { resolveMtlsConfig } from "../src/config.js";
import type { ClientCertInfo, MtlsConfig } from "../src/shared/types.js";

const config: MtlsConfig = resolveMtlsConfig({
  enabled: true,
  tls: {
    certFile: "/tmp/server.crt",
    keyFile: "/tmp/server.key",
    caFile: "/tmp/ca.crt",
  },
});

const verifiedCert: ClientCertInfo = {
  subject: "service-a",
  issuer: "PartMe CA",
  fingerprint: "AA:BB:CC",
  verified: true,
};

describe("mTLS request policy", () => {
  it("protects root by default but skips health and status", () => {
    expect(isPathProtected(config, "/v1/chat")).toBe(true);
    expect(isPathProtected(config, "/health")).toBe(false);
    expect(isPathProtected(config, "/mtls/status")).toBe(false);
  });

  it("honors allowUnauthenticated on a matching rule", () => {
    const next = resolveMtlsConfig({
      ...config,
      protectedPaths: [
        { path: "/public", match: "prefix", allowUnauthenticated: true },
        { path: "/", match: "prefix", allowUnauthenticated: false },
      ],
    });

    expect(isPathProtected(next, "/public/info")).toBe(false);
    expect(isPathProtected(next, "/private")).toBe(true);
  });

  it("rejects missing and unverified certificates on protected paths", () => {
    expect(authorizeMtlsRequest(config, "/v1/chat", undefined)).toMatchObject({
      allowed: false,
      statusCode: 401,
    });
    expect(
      authorizeMtlsRequest(config, "/v1/chat", { ...verifiedCert, verified: false }),
    ).toMatchObject({ allowed: false, statusCode: 401 });
  });

  it("rejects certificates outside the configured allowlist", () => {
    const next = resolveMtlsConfig({
      ...config,
      allowedClients: [{ cn: "service-b" }],
    });

    expect(authorizeMtlsRequest(next, "/v1/chat", verifiedCert)).toMatchObject({
      allowed: false,
      statusCode: 403,
    });
  });

  it("allows verified certificates and exposes their principal", () => {
    expect(authorizeMtlsRequest(config, "/v1/chat", verifiedCert)).toEqual({
      allowed: true,
      authenticated: true,
      principal: "service-a",
      certificate: verifiedCert,
    });
  });

  it("allows configured public paths without a certificate", () => {
    expect(authorizeMtlsRequest(config, "/health", undefined)).toEqual({
      allowed: true,
      authenticated: false,
    });
  });

  it("overwrites spoofable identity and forwarding headers", () => {
    const headers = buildForwardHeaders(
      config,
      {
        host: "gateway.example.com",
        "x-forwarded-user": "attacker",
        "x-client-cert": "forged",
        "x-forwarded-for": "203.0.113.10",
      },
      verifiedCert,
      "192.0.2.25",
    );

    expect(headers["x-forwarded-user"]).toBe("service-a");
    expect(headers["x-client-cert"]).toBe("service-a");
    expect(headers["x-forwarded-for"]).toBe("192.0.2.25");
    expect(headers["x-forwarded-proto"]).toBe("https");
  });
});

describe("mTLS configuration", () => {
  it("defaults to a disabled fail-closed proxy", () => {
    const resolved = resolveMtlsConfig({});
    expect(resolved.enabled).toBe(false);
    expect(resolved.proxy.listenPort).toBe(18443);
    expect(resolved.proxy.upstreamPort).toBe(18789);
    expect(resolved.tls.rejectUnauthorized).toBe(true);
  });

  it("rejects incomplete enabled TLS configuration", () => {
    expect(() => resolveMtlsConfig({ enabled: true })).toThrow(/certFile/);
  });
});
