import type { MtlsConfig } from "./shared/types.js";

export type MtlsConfigInput = Partial<Omit<MtlsConfig, "tls" | "proxy">> & {
  tls?: Partial<MtlsConfig["tls"]>;
  proxy?: Partial<MtlsConfig["proxy"]>;
};

const DEFAULT_CONFIG: MtlsConfig = {
  enabled: false,
  tls: {
    enabled: true,
    certFile: "",
    keyFile: "",
    caFile: "",
    requestCert: true,
    rejectUnauthorized: true,
  },
  proxy: {
    listenHost: "0.0.0.0",
    listenPort: 18443,
    upstreamHost: "127.0.0.1",
    upstreamPort: 18789,
    requestTimeoutMs: 30_000,
    userHeader: "x-forwarded-user",
  },
  protectedPaths: [{ path: "/", match: "prefix", allowUnauthenticated: false }],
  allowedClients: [],
  skipPaths: ["/health", "/auth/status", "/mtls/status"],
  passthrough: false,
  headerName: "x-client-cert",
  headerCertField: "subject",
};

function requireNonEmpty(value: string, field: string): void {
  if (!value.trim()) {
    throw new Error(`[openclaw-mtls] ${field} is required when mTLS proxy is enabled`);
  }
}

function requirePort(value: number, field: string, allowEphemeral = false): void {
  const minimum = allowEphemeral ? 0 : 1;
  if (!Number.isInteger(value) || value < minimum || value > 65535) {
    throw new Error(
      `[openclaw-mtls] ${field} must be an integer between ${minimum} and 65535`,
    );
  }
}

export function resolveMtlsConfig(input: MtlsConfigInput | undefined): MtlsConfig {
  const config: MtlsConfig = {
    ...DEFAULT_CONFIG,
    ...input,
    tls: { ...DEFAULT_CONFIG.tls, ...input?.tls },
    proxy: { ...DEFAULT_CONFIG.proxy, ...input?.proxy },
    protectedPaths: input?.protectedPaths ?? DEFAULT_CONFIG.protectedPaths,
    allowedClients: input?.allowedClients ?? DEFAULT_CONFIG.allowedClients,
    skipPaths: input?.skipPaths ?? DEFAULT_CONFIG.skipPaths,
  };

  requirePort(config.proxy.listenPort, "proxy.listenPort", true);
  requirePort(config.proxy.upstreamPort, "proxy.upstreamPort");
  if (!Number.isInteger(config.proxy.requestTimeoutMs) || config.proxy.requestTimeoutMs < 1_000) {
    throw new Error("[openclaw-mtls] proxy.requestTimeoutMs must be at least 1000ms");
  }
  requireNonEmpty(config.proxy.userHeader, "proxy.userHeader");

  if (config.enabled) {
    if (!config.tls.enabled) {
      throw new Error("[openclaw-mtls] tls.enabled must be true when mTLS proxy is enabled");
    }
    requireNonEmpty(config.tls.certFile, "tls.certFile");
    requireNonEmpty(config.tls.keyFile, "tls.keyFile");
    requireNonEmpty(config.tls.caFile, "tls.caFile");
    if (!config.tls.requestCert && config.protectedPaths.some((rule) => !rule.allowUnauthenticated)) {
      throw new Error("[openclaw-mtls] tls.requestCert must be true when protected paths are configured");
    }
  }

  return config;
}
