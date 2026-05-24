/**
 * @fileoverview mTLS 安全鉴权插件入口 — Mutual TLS 双向证书认证。
 *
 * @module mtls
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

/**
 * 从 TLS socket 提取对端客户端证书信息。
 *
 * @param socket - Node.js TLSSocket；非 TLS 或未提供证书时返回 undefined
 * @returns 解析后的证书 subject/issuer/fingerprint 等，或 undefined
 */
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

/**
 * 由客户端证书构造 mTLS 认证上下文。
 *
 * @param cert - 客户端证书信息；缺失时 authenticated=false
 * @returns 注入到请求对象的 MtlsAuthContext
 */
function buildAuthContext(cert: ClientCertInfo | undefined): MtlsAuthContext {
  return {
    authenticated: !!cert?.subject,
    clientCert: cert,
    principal: cert?.subject,
    method: "mtls",
    timestamp: new Date().toISOString(),
  };
}

/**
 * 判断 URL 路径是否受 mTLS 保护（排除 skipPaths 后匹配 protectedPaths）。
 *
 * @param cfg - mTLS 插件配置
 * @param urlPath - 不含 query 的路径
 * @returns 是否需要客户端证书
 */
function isPathProtected(cfg: MtlsConfig, urlPath: string): boolean {
  if (cfg.skipPaths.some((p) => urlPath === p || urlPath.startsWith(p + "/"))) {
    return false;
  }
  return cfg.protectedPaths.some((rule) => {
    if (rule.match === "exact") return urlPath === rule.path;
    return urlPath.startsWith(rule.path);
  });
}

/**
 * 校验客户端是否在 allowedClients 白名单内；白名单为空时允许任意已验证客户端。
 *
 * @param cfg - mTLS 插件配置
 * @param cert - 客户端证书信息
 * @returns 是否允许访问受保护路径
 */
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

/** 返回 401 JSON 并设置 WWW-Authenticate: Mutual。 */
function sendUnauthorized(res: ServerResponse, message = "mTLS authentication required"): void {
  res.writeHead(401, {
    "Content-Type": "application/json",
    "WWW-Authenticate": 'Mutual realm="openclaw-mtls"',
  });
  res.end(JSON.stringify({ error: "unauthorized", message }));
}

/**
 * 创建 mTLS HTTP 中间件：校验证书、白名单，并将 AuthContext 注入请求。
 *
 * @param cfg - mTLS 配置
 * @param stats - 可变的请求统计快照（就地更新）
 * @returns Express 风格 `(req, res, next)` 中间件
 */
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

/**
 * 从 OpenClaw 全局配置合并 mTLS 默认值。
 *
 * @param globalConfig - `openclaw.json` 运行时配置对象
 * @returns 完整 MtlsConfig
 */
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

/**
 * 在 Gateway 就绪后延迟执行初始化（registerService → onReady → microtask）。
 *
 * @param api - 插件 API
 * @param name - 服务 id / 日志前缀
 * @param callback - 异步初始化逻辑
 */
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

/**
 * OpenClaw mTLS 插件注册入口：状态路由 + 全局证书校验中间件。
 *
 * @param api - Gateway 注入的插件 API
 */
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
