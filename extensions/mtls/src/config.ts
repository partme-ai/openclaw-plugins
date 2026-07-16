/**
 * @fileoverview OpenClaw mTLS 反向代理的配置合并与封闭式安全校验。
 *
 * 启用时强制双向证书校验、禁止透传模式、限制上游只能是本机 Gateway，并校验身份 Header
 * 不与保留头冲突。启动前还会核对 OpenClaw 的 trusted-proxy 配置，避免代理看似可用但
 * Gateway 实际不信任其身份声明。
 */
import type { MtlsConfig } from "./shared/types.js";

export type MtlsConfigInput = Partial<Omit<MtlsConfig, "tls" | "proxy">> & {
  tls?: Partial<MtlsConfig["tls"]>;
  proxy?: Partial<MtlsConfig["proxy"]>;
};

export type OpenClawGatewayConfigSlice = {
  gateway?: {
    port?: number;
    trustedProxies?: string[];
    auth?: {
      mode?: string;
      trustedProxy?: {
        userHeader?: string;
        allowLoopback?: boolean;
      };
    };
  };
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
  skipPaths: ["/health", "/auth/status"],
  passthrough: false,
  headerName: "x-client-cert",
  headerCertField: "subject",
};

function requireNonEmpty(value: string, field: string): void {
  if (!value.trim()) {
    throw new Error(`[openclaw-mtls] ${field} is required when mTLS proxy is enabled`);
  }
}

const HTTP_HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const FORBIDDEN_IDENTITY_HEADERS = new Set([
  "authorization",
  "connection",
  "cookie",
  "forwarded",
  "host",
  "proxy-authorization",
  "transfer-encoding",
  "upgrade",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-real-ip",
]);

function requireHeaderName(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!HTTP_HEADER_NAME.test(normalized)) {
    throw new Error(`[openclaw-mtls] ${field} must be a valid HTTP header name`);
  }
  if (FORBIDDEN_IDENTITY_HEADERS.has(normalized)) {
    throw new Error(`[openclaw-mtls] ${field} cannot use reserved header ${normalized}`);
  }
  return normalized;
}

function validatePath(path: string, field: string): void {
  if (!path.startsWith("/") || path.includes("?") || path.includes("#")) {
    throw new Error(`[openclaw-mtls] ${field} must be an absolute URL pathname`);
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

function requireLoopbackUpstream(host: string): "127.0.0.1" | "::1" {
  const normalized = host.trim().toLowerCase();
  if (normalized === "127.0.0.1" || normalized === "::1") return normalized;
  throw new Error(
    "[openclaw-mtls] proxy.upstreamHost must be 127.0.0.1 or ::1; the plugin may only proxy to its local OpenClaw Gateway",
  );
}

/** 合并默认值并校验 mTLS、代理、路径规则和客户端白名单。 */
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
  const userHeader = requireHeaderName(config.proxy.userHeader, "proxy.userHeader");
  const certificateHeader = requireHeaderName(config.headerName, "headerName");
  if (userHeader === certificateHeader) {
    throw new Error("[openclaw-mtls] proxy.userHeader and headerName must be different");
  }
  config.proxy.userHeader = userHeader;
  config.headerName = certificateHeader;

  config.protectedPaths.forEach((rule, index) => {
    validatePath(rule.path, `protectedPaths[${index}].path`);
    if (rule.match !== "exact" && rule.match !== "prefix") {
      throw new Error(`[openclaw-mtls] protectedPaths[${index}].match must be exact or prefix`);
    }
  });
  config.skipPaths.forEach((path, index) => validatePath(path, `skipPaths[${index}]`));
  config.allowedClients.forEach((client, index) => {
    if (![client.cn, client.issuer, client.fingerprint].some((value) => value?.trim())) {
      throw new Error(
        `[openclaw-mtls] allowedClients[${index}] must define cn, issuer, or fingerprint`,
      );
    }
  });

  if (config.enabled) {
    if (!config.tls.enabled) {
      throw new Error("[openclaw-mtls] tls.enabled must be true when mTLS proxy is enabled");
    }
    requireNonEmpty(config.tls.certFile, "tls.certFile");
    requireNonEmpty(config.tls.keyFile, "tls.keyFile");
    requireNonEmpty(config.tls.caFile, "tls.caFile");
    if (!config.tls.requestCert) {
      throw new Error("[openclaw-mtls] tls.requestCert must be true when the mTLS proxy is enabled");
    }
    if (!config.tls.rejectUnauthorized) {
      throw new Error(
        "[openclaw-mtls] tls.rejectUnauthorized must be true when the mTLS proxy is enabled",
      );
    }
    if (config.passthrough) {
      throw new Error(
        "[openclaw-mtls] passthrough cannot be enabled; use protectedPaths.allowUnauthenticated or skipPaths for explicit public routes",
      );
    }
    config.proxy.upstreamHost = requireLoopbackUpstream(config.proxy.upstreamHost);
  }

  return config;
}


/**
 * 在监听端口打开前校验 OpenClaw 官方 trusted-proxy 契约。
 * 该检查同时防止身份 Header 被 Gateway 拒绝，以及错误地把流量代理到远程 Gateway。
 */
export function validateMtlsGatewayIntegration(
  config: MtlsConfig,
  openClawConfig: OpenClawGatewayConfigSlice,
): void {
  if (!config.enabled) return;

  const gateway = openClawConfig.gateway;
  const auth = gateway?.auth;
  if (auth?.mode !== "trusted-proxy") {
    throw new Error(
      "[openclaw-mtls] gateway.auth.mode must be trusted-proxy when the mTLS proxy is enabled",
    );
  }

  const configuredHeader = auth.trustedProxy?.userHeader?.trim().toLowerCase();
  if (configuredHeader !== config.proxy.userHeader) {
    throw new Error(
      `[openclaw-mtls] gateway.auth.trustedProxy.userHeader must equal ${config.proxy.userHeader}`,
    );
  }
  if (auth.trustedProxy?.allowLoopback !== true) {
    throw new Error(
      "[openclaw-mtls] gateway.auth.trustedProxy.allowLoopback must be true for the local mTLS proxy",
    );
  }

  const trustedProxies = gateway?.trustedProxies?.map((value) => value.trim()) ?? [];
  if (!trustedProxies.includes(config.proxy.upstreamHost)) {
    throw new Error(
      `[openclaw-mtls] gateway.trustedProxies must include ${config.proxy.upstreamHost}`,
    );
  }

  const gatewayPort = gateway?.port ?? 18789;
  if (gatewayPort !== config.proxy.upstreamPort) {
    throw new Error(
      `[openclaw-mtls] proxy.upstreamPort (${config.proxy.upstreamPort}) must match gateway.port (${gatewayPort})`,
    );
  }
}
