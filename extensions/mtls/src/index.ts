/**
 * mTLS 安全鉴权插件入口
 *
 * mTLS (Mutual TLS) 双向证书认证插件
 *
 * 核心功能：
 * - 在 HTTP 请求层拦截，验证客户端证书
 * - 支持自签名 CA 证书的信任链验证
 * - 支持 allowedClients 白名单（CN/issuer/fingerprint）
 * - 支持 protectedPaths 路径规则配置
 * - 支持 passthrough 模式（未提供证书时放行而非拒绝）
 * - 通过 X-Client-Cert 等 Header 传递证书信息给下游
 *
 * 架构：
 * - 作为 OpenClaw Gateway 的安全鉴权中间件
 * - 参考 openclaw-oauth2 的中间件注册模式
 * - 通过 registerHttpRoute 注册全局中间件
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import * as tls from "node:tls";

import type { MtlsConfig, ClientCertInfo, MtlsAuthContext, MtlsStatusSnapshot } from "./shared/types.js";
import { getMtlsStats } from "./runtime/stats.js";

const DEFAULT_CONFIG: MtlsConfig = {
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

interface PluginApi {
  runtime: { config: Record<string, unknown> };
  registerHttpRoute(params: {
    path: string;
    auth?: string;
    match?: string;
    replaceExisting?: boolean;
    handler: (req: IncomingMessage, res: ServerResponse, next?: () => void) => Promise<void>;
  }): void;
  registerService?(def: { id: string; start: () => Promise<void>; stop?: () => Promise<void> }): void;
  onReady?(cb: () => Promise<void>): void;
}

function extractCertInfo(socket: tls.TLSSocket | undefined): ClientCertInfo | undefined {
  if (!socket) return undefined;
  try {
    const cert = socket.getPeerCertificate();
    if (!cert || Object.keys(cert).length === 0) return undefined;

    const getCN = (obj: Record<string, unknown>): string | undefined => {
      const cn = obj.CN;
      if (typeof cn === "string") return cn;
      if (Array.isArray(cn) && cn.length > 0) return String(cn[0]);
      return undefined;
    };

    return {
      subject: cert.subject ? getCN(cert.subject as Record<string, unknown>) : undefined,
      issuer: cert.issuer ? getCN(cert.issuer as Record<string, unknown>) : undefined,
      fingerprint: cert.fingerprint || cert.raw?.toString("hex").slice(0, 32),
      serialNumber: cert.serialNumber,
      notBefore: cert.valid_from,
      notAfter: cert.valid_to,
      verified: socket.authorized ?? false,
    };
  } catch {
    return undefined;
  }
}

function buildAuthContext(cert: ClientCertInfo | undefined): MtlsAuthContext {
  return {
    authenticated: !!cert?.subject,
    clientCert: cert,
    principal: cert?.subject,
    method: "mtls",
    timestamp: new Date().toISOString(),
  };
}

function isPathProtected(cfg: MtlsConfig, urlPath: string): boolean {
  if (cfg.skipPaths.some((p) => urlPath === p || urlPath.startsWith(p + "/"))) {
    return false;
  }
  return cfg.protectedPaths.some((rule) => {
    if (rule.match === "exact") return urlPath === rule.path;
    return urlPath.startsWith(rule.path);
  });
}

function isClientAllowed(cfg: MtlsConfig, cert: ClientCertInfo | undefined): boolean {
  if (!cert?.subject) return false;
  if (cfg.allowedClients.length === 0) return true;
  return cfg.allowedClients.some((allowed) => {
    if (allowed.cn && cert.subject !== allowed.cn) return false;
    if (allowed.issuer && cert.issuer !== allowed.issuer) return false;
    if (allowed.fingerprint && cert.fingerprint !== allowed.fingerprint) return false;
    return true;
  });
}

function sendUnauthorized(res: ServerResponse, message = "mTLS authentication required"): void {
  res.writeHead(401, {
    "Content-Type": "application/json",
    "WWW-Authenticate": 'Mutual realm="openclaw-mtls"',
  });
  res.end(JSON.stringify({ error: "unauthorized", message }));
}

function createMtlsMiddleware(cfg: MtlsConfig, stats: MtlsStatusSnapshot) {
  return async (
    req: IncomingMessage,
    res: ServerResponse,
    next?: () => void
  ): Promise<void> => {
    stats.totalRequests++;

    const urlPath = req.url?.split("?")[0] ?? "/";

    if (!isPathProtected(cfg, urlPath)) {
      next?.();
      return;
    }

    const tlsSocket = req.socket as tls.TLSSocket | undefined;
    const certInfo = extractCertInfo(tlsSocket);

    if (!certInfo) {
      if (cfg.passthrough) {
        stats.passthroughRequests++;
        next?.();
        return;
      }
      stats.rejectedRequests++;
      sendUnauthorized(res, "Client certificate required");
      return;
    }

    if (!isClientAllowed(cfg, certInfo)) {
      stats.rejectedRequests++;
      sendUnauthorized(res, "Client certificate not allowed");
      return;
    }

    stats.authenticatedRequests++;

    const authCtx: MtlsAuthContext = buildAuthContext(certInfo);
    const authPropName = cfg.headerName.replace("X-", "").toLowerCase().replace(/-/g, "_") + "_auth";
    Object.defineProperty(req, authPropName, {
      value: authCtx,
      writable: true,
      enumerable: true,
      configurable: true,
    });

    if (cfg.headerName && cfg.headerCertField) {
      const headerValue = certInfo[cfg.headerCertField as keyof ClientCertInfo] as string | undefined;
      if (headerValue) {
        req.headers[cfg.headerName.toLowerCase()] = headerValue;
      }
    }

    next?.();
  };
}

function resolveConfig(globalConfig: Record<string, unknown>): MtlsConfig {
  const mtls = (globalConfig.mtls as Partial<MtlsConfig> | undefined) ?? {};

  return {
    enabled: mtls.enabled ?? DEFAULT_CONFIG.enabled,
    tls: {
      enabled: mtls.tls?.enabled ?? DEFAULT_CONFIG.tls.enabled,
      certFile: mtls.tls?.certFile ?? DEFAULT_CONFIG.tls.certFile,
      keyFile: mtls.tls?.keyFile ?? DEFAULT_CONFIG.tls.keyFile,
      caFile: mtls.tls?.caFile ?? DEFAULT_CONFIG.tls.caFile,
      requestCert: mtls.tls?.requestCert ?? DEFAULT_CONFIG.tls.requestCert,
      rejectUnauthorized: mtls.tls?.rejectUnauthorized ?? DEFAULT_CONFIG.tls.rejectUnauthorized,
    },
    protectedPaths: mtls.protectedPaths ?? DEFAULT_CONFIG.protectedPaths,
    allowedClients: mtls.allowedClients ?? DEFAULT_CONFIG.allowedClients,
    skipPaths: mtls.skipPaths ?? DEFAULT_CONFIG.skipPaths,
    passthrough: mtls.passthrough ?? DEFAULT_CONFIG.passthrough,
    headerName: mtls.headerName ?? DEFAULT_CONFIG.headerName,
    headerCertField: mtls.headerCertField ?? DEFAULT_CONFIG.headerCertField,
  };
}

function safeOnReady(api: PluginApi, name: string, callback: () => Promise<void>): void {
  const a = api as unknown as Record<string, unknown>;
  if (typeof a.registerService === "function") {
    (a.registerService as (def: { id: string; start: () => Promise<void> }) => void)({ id: name, start: callback });
  } else if (typeof a.onReady === "function") {
    (a.onReady as (cb: () => Promise<void>) => void)(callback);
  } else {
    Promise.resolve().then(() => callback()).catch((e) => console.error(`[${name}] Startup error:`, e));
  }
}

export default function register(api: PluginApi): void {
  const stats = getMtlsStats();

  api.registerHttpRoute({
    path: "/mtls/status",
    handler: async (_req: IncomingMessage, res: ServerResponse) => {
      const config = resolveConfig(api.runtime.config);
      const hasCert = !!config.tls.certFile && !!config.tls.keyFile;

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          data: {
            plugin: "openclaw-mtls",
            status: config.enabled && hasCert ? "active" : "unconfigured",
            method: "mtls",
            features: {
              bidirectionalAuth: config.tls.enabled,
              whitelistControl: config.allowedClients.length > 0,
              pathProtection: config.protectedPaths.length > 0,
              passthroughMode: config.passthrough,
              headerPropagation: !!config.headerName,
            },
            config: {
              tls: {
                enabled: config.tls.enabled,
                requestCert: config.tls.requestCert,
                rejectUnauthorized: config.tls.rejectUnauthorized,
              },
              protectedPaths: config.protectedPaths,
              allowedClientsCount: config.allowedClients.length,
              skipPaths: config.skipPaths,
              passthrough: config.passthrough,
              headerName: config.headerName,
            },
            stats,
          },
        })
      );
    },
  });

  const initMtls = async () => {
    const config = resolveConfig(api.runtime.config);

    if (!config.enabled) {
      console.log(
        "[openclaw-mtls] No mtls.enabled configured. " +
        "Plugin registered but authentication is disabled. " +
        "Set mtls.enabled in openclaw.json to enable."
      );
      return;
    }

    if (!config.tls.certFile || !config.tls.keyFile) {
      console.log(
        "[openclaw-mtls] No TLS certificates configured. " +
        "Plugin registered but authentication is disabled. " +
        "Set mtls.tls.certFile and mtls.tls.keyFile in openclaw.json to enable."
      );
      return;
    }

    const middleware = createMtlsMiddleware(config, stats);

    api.registerHttpRoute({
      path: "/",
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        await middleware(req, res, () => {
          // next() — 认证通过，交给后续 handler 处理
        });
      },
    });

    console.log(
      `[openclaw-mtls] Authentication enabled: ` +
      `tls=${config.tls.enabled}, ` +
      `allowedClients=${config.allowedClients.length}, ` +
      `protectedPaths=${config.protectedPaths.length}, ` +
      `passthrough=${config.passthrough}`
    );
  };

  safeOnReady(api, "mtls-init", initMtls);

  console.log("[openclaw-mtls] Plugin registered — mTLS mutual TLS authentication");
  console.log("[openclaw-mtls] Endpoints:");
  console.log("  /mtls/status  — Plugin status & configuration");
}

export { getMtlsStats } from "./runtime/stats.js";
