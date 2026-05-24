/**
 * openclaw-oauth2 插件入口
 *
 * OAuth 2.0 认证后端插件 — 深度整合 Sa-Token OAuth2 Server
 *
 * 架构：
 * - Sa-Token OAuth2 Server（Java/Spring Boot SCRM 后端）签发 Token
 * - 本插件作为 Resource Server / Token 验证器
 * - JWT 优先 + Introspection 降级
 *
 * 核心模块：
 * - satoken-discovery.ts  — OIDC Discovery + JWKS 自动获取
 * - satoken-jwt.ts        — RS256 JWT 本地验证（零网络开销）
 * - satoken-introspection.ts — 不透明 Token 降级回调
 * - satoken-scope-mapper.ts  — scope → OpenClaw 权限映射
 * - middleware.ts          — Bearer Token 拦截 + AuthContext 注入
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { PluginApi, AuthOAuth2Config } from "./shared/types.js";
import { SaTokenDiscovery } from "./auth/satoken-discovery.js";
import { SaTokenIntrospection } from "./auth/satoken-introspection.js";
import { createAuthMiddleware } from "./auth/middleware.js";

/** 默认 OAuth2 配置 */
const DEFAULT_CONFIG: AuthOAuth2Config = {
  provider: "sa-token",
  issuerUrl: "",
  clientId: "openclaw-gateway",
  tokenFormat: "jwt-prefer",
  scopeMapping: {
    "openclaw:admin": "admin",
    "openclaw:operator": "operator",
    "openclaw:viewer": "viewer",
  },
  jwksCacheTtl: 3600,
  introspectionCacheTtl: 30,
  skipPaths: ["/auth/status", "/health", "/auth/oauth2/status"],
  satoken: {
    loginIdClaim: "loginId",
    tenantIdClaim: "tenantId",
    loginTypeClaim: "loginType",
  },
};

/** Discovery 实例（模块级） */
let discovery: SaTokenDiscovery | null = null;

/** Introspection 实例（模块级） */
let introspection: SaTokenIntrospection | null = null;

/**
 * 安全的 onReady 替代方案
 * 优先 registerService → onReady → 延迟执行
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
 * 插件注册入口
 * 由 OpenClaw Gateway 在加载插件时调用
 *
 * @param api - Gateway 注入的插件 API
 */
export default function register(api: PluginApi): void {
  // ──────────── 状态端点 ────────────
  api.registerHttpRoute({
    path: "/auth/oauth2/status",
    handler: async (_req, res) => {
      const config = resolveConfig(api.runtime.config);
      const hasIssuer = !!config.issuerUrl;

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          data: {
            plugin: "openclaw-oauth2",
            status: hasIssuer ? "active" : "unconfigured",
            provider: config.provider,
            issuerUrl: config.issuerUrl || "(not set)",
            tokenFormat: config.tokenFormat,
            features: {
              oidcDiscovery: hasIssuer,
              jwtValidation: hasIssuer,
              tokenIntrospection: hasIssuer && config.tokenFormat !== "jwt-only",
              scopeMapping: true,
            },
            discoveryReady: discovery?.getOidcConfig() !== null,
          },
        })
      );
    },
  });

  // ──────────── 插件初始化 ────────────
  const initAuth = async () => {
    const config = resolveConfig(api.runtime.config);

    if (!config.issuerUrl) {
      console.log(
        "[openclaw-oauth2] No issuerUrl configured. " +
        "Plugin registered but authentication is disabled. " +
        "Set oauth2.issuerUrl in openclaw.json to enable."
      );
      return;
    }

    // 初始化 Discovery
    discovery = new SaTokenDiscovery(config.issuerUrl, config.jwksCacheTtl);
    await discovery.init();

    // 初始化 Introspection
    introspection = new SaTokenIntrospection(config, discovery);

    // 创建并注册中间件
    const middleware = createAuthMiddleware(config, discovery, introspection);

    // 注册全局中间件路由
    // 所有请求都经过此端点进行认证
    api.registerHttpRoute({
      path: "/",
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        await middleware(req, res, () => {
          // next() — 认证通过，交给后续 handler 处理
          // OpenClaw Gateway 会自动路由到对应的 handler
        });
      },
    });

    console.log(
      `[openclaw-oauth2] Authentication enabled: ` +
      `provider=${config.provider}, issuer=${config.issuerUrl}, ` +
      `strategy=${config.tokenFormat}`
    );
  };
  safeOnReady(api, "auth-oauth2-init", initAuth);

  console.log("[openclaw-oauth2] Plugin registered — Sa-Token OAuth2 integration");
  console.log("[openclaw-oauth2] Endpoints:");
  console.log("  /auth/oauth2/status  — Plugin status & configuration");
}

/**
 * 解析 OAuth2 配置
 * 合并默认值和用户配置
 *
 * @param globalConfig - OpenClaw 全局配置
 * @returns 合并后的 OAuth2 配置
 */
function resolveConfig(globalConfig: Record<string, unknown>): AuthOAuth2Config {
  const oauth2 = globalConfig.oauth2 as Partial<AuthOAuth2Config> | undefined;

  return {
    provider: oauth2?.provider ?? DEFAULT_CONFIG.provider,
    issuerUrl: oauth2?.issuerUrl ?? DEFAULT_CONFIG.issuerUrl,
    clientId: oauth2?.clientId ?? DEFAULT_CONFIG.clientId,
    clientSecret: oauth2?.clientSecret,
    audience: oauth2?.audience,
    tokenFormat: oauth2?.tokenFormat ?? DEFAULT_CONFIG.tokenFormat,
    scopeMapping: {
      ...DEFAULT_CONFIG.scopeMapping,
      ...(oauth2?.scopeMapping ?? {}),
    },
    jwksCacheTtl: oauth2?.jwksCacheTtl ?? DEFAULT_CONFIG.jwksCacheTtl,
    introspectionCacheTtl: oauth2?.introspectionCacheTtl ?? DEFAULT_CONFIG.introspectionCacheTtl,
    skipPaths: oauth2?.skipPaths ?? DEFAULT_CONFIG.skipPaths,
    satoken: {
      loginIdClaim: oauth2?.satoken?.loginIdClaim ?? DEFAULT_CONFIG.satoken.loginIdClaim,
      tenantIdClaim: oauth2?.satoken?.tenantIdClaim ?? DEFAULT_CONFIG.satoken.tenantIdClaim,
      loginTypeClaim: oauth2?.satoken?.loginTypeClaim ?? DEFAULT_CONFIG.satoken.loginTypeClaim,
    },
    gatewayToken: oauth2?.gatewayToken,
  };
}
