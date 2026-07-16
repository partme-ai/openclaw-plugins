import { describe, expect, it } from "vitest";

import {
  authorizeMtlsRequest,
  buildForwardHeaders,
  isPathProtected,
} from "../src/policy.js";
import { resolveMtlsConfig } from "../src/config.js";
import { validateMtlsGatewayIntegration } from "../src/config.js";
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
  it("protects root and authenticated status by default but skips health", () => {
    expect(isPathProtected(config, "/v1/chat")).toBe(true);
    expect(isPathProtected(config, "/health")).toBe(false);
    expect(isPathProtected(config, "/mtls/status")).toBe(true);
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

  it("does not promote a disallowed certificate to an identity on a public path", () => {
    const next = resolveMtlsConfig({
      ...config,
      allowedClients: [{ cn: "service-b" }],
    });

    expect(authorizeMtlsRequest(next, "/health", verifiedCert)).toEqual({
      allowed: true,
      authenticated: false,
    });
  });

  it("matches certificate fingerprints case-insensitively", () => {
    const next = resolveMtlsConfig({
      ...config,
      allowedClients: [{ fingerprint: "aa:bb:cc" }],
    });

    expect(authorizeMtlsRequest(next, "/v1/chat", verifiedCert)).toMatchObject({
      allowed: true,
      authenticated: true,
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
        "x-forwarded-proto": "http",
        "x-forwarded-host": "attacker.example",
        forwarded: "for=203.0.113.10",
        "x-real-ip": "203.0.113.10",
        connection: "keep-alive, x-smuggled-header",
        "x-smuggled-header": "must-not-reach-upstream",
        "proxy-authorization": "Basic forged",
      },
      verifiedCert,
      "192.0.2.25",
    );

    expect(headers["x-forwarded-user"]).toBe("service-a");
    expect(headers["x-client-cert"]).toBe("service-a");
    expect(headers["x-forwarded-for"]).toBe("192.0.2.25");
    expect(headers["x-forwarded-proto"]).toBe("https");
    expect(headers["x-forwarded-host"]).toBe("gateway.example.com");
    expect(headers.forwarded).toBeUndefined();
    expect(headers["x-real-ip"]).toBeUndefined();
    expect(headers.connection).toBeUndefined();
    expect(headers["x-smuggled-header"]).toBeUndefined();
    expect(headers["proxy-authorization"]).toBeUndefined();
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

  it("rejects unsafe identity headers and empty allowlist entries", () => {
    expect(() => resolveMtlsConfig({ proxy: { userHeader: "authorization" } })).toThrow(
      /reserved header/,
    );
    expect(() => resolveMtlsConfig({ allowedClients: [{}] })).toThrow(/allowedClients\[0\]/);
  });

  it("rejects malformed path rules", () => {
    expect(() => resolveMtlsConfig({ skipPaths: ["health"] })).toThrow(/absolute URL pathname/);
  });

  it("rejects unsafe enabled-mode escape hatches and remote upstreams", () => {
    expect(() => resolveMtlsConfig({ ...config, passthrough: true })).toThrow(/passthrough/);
    expect(() =>
      resolveMtlsConfig({ ...config, tls: { ...config.tls, rejectUnauthorized: false } }),
    ).toThrow(/rejectUnauthorized/);
    expect(() =>
      resolveMtlsConfig({ ...config, proxy: { ...config.proxy, upstreamHost: "gateway.internal" } }),
    ).toThrow(/local OpenClaw Gateway/);
  });

  it("validates the OpenClaw trusted-proxy integration contract", () => {
    const gatewayConfig = {
      gateway: {
        port: 18789,
        trustedProxies: ["127.0.0.1"],
        auth: {
          mode: "trusted-proxy",
          trustedProxy: { userHeader: "x-forwarded-user", allowLoopback: true },
        },
      },
    };
    expect(() => validateMtlsGatewayIntegration(config, gatewayConfig)).not.toThrow();
    expect(() =>
      validateMtlsGatewayIntegration(config, {
        ...gatewayConfig,
        gateway: { ...gatewayConfig.gateway, trustedProxies: [] },
      }),
    ).toThrow(/trustedProxies/);
    expect(() =>
      validateMtlsGatewayIntegration(config, {
        ...gatewayConfig,
        gateway: { ...gatewayConfig.gateway, auth: { mode: "token" } },
      }),
    ).toThrow(/trusted-proxy/);
    expect(() =>
      validateMtlsGatewayIntegration(config, {
        ...gatewayConfig,
        gateway: {
          ...gatewayConfig.gateway,
          auth: {
            mode: "trusted-proxy",
            trustedProxy: { userHeader: "x-other-user", allowLoopback: true },
          },
        },
      }),
    ).toThrow(/userHeader/);
    expect(() =>
      validateMtlsGatewayIntegration(config, {
        ...gatewayConfig,
        gateway: { ...gatewayConfig.gateway, port: 18790 },
      }),
    ).toThrow(/upstreamPort/);
  });
});
