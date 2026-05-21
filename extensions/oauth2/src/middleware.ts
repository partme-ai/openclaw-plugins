/**
 * Bearer Token 拦截中间件 + AuthContext 注入
 *
 * 职责：
 * - 拦截所有 HTTP 请求
 * - 从 Authorization: Bearer xxx 或 ?token=xxx 提取 Token
 * - 调用 JWT 验证（主路径）或 Introspection 降级
 * - 构造 AuthContext 注入到请求对象
 * - 跳过公开路径（/auth/status, /health 等）
 * - 向后兼容 gatewayToken 开发模式
 *
 * 与 openclaw_management withAuth() 的集成：
 * - 本中间件在 Gateway 级别运行，早于 management handler
 * - 验证通过后注入 req.authContext
 * - management 的 withAuth() 检测到 authContext 存在时直接使用
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  AuthOAuth2Config,
  AuthContext,
  AuthenticatedRequest,
} from "./types.js";
import { JwtError } from "./types.js";
import { isJwtToken, verifyJwt } from "./satoken-jwt.js";
import { mapScopesToRole, mapScopesToPermissions, parseScopeString } from "./satoken-scope-mapper.js";
import type { SaTokenDiscovery } from "./satoken-discovery.js";
import type { SaTokenIntrospection } from "./satoken-introspection.js";

/** 中间件处理函数类型 */
export type MiddlewareHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void | Promise<void>
) => Promise<void>;

/**
 * 创建 Auth 中间件
 * 工厂函数，返回配置好的中间件
 *
 * @param config - OAuth2 配置
 * @param discovery - OIDC Discovery 实例
 * @param introspection - Token Introspection 实例
 * @returns 中间件处理函数
 */
export function createAuthMiddleware(
  config: AuthOAuth2Config,
  discovery: SaTokenDiscovery,
  introspection: SaTokenIntrospection
): MiddlewareHandler {
  return async (req, res, next) => {
    const url = req.url ?? "/";
    const path = url.split("?")[0];

    // 检查是否为公开路径
    if (isSkipPath(path, config.skipPaths)) {
      await next();
      return;
    }

    // 提取 Token
    const token = extractToken(req);
    if (!token) {
      sendUnauthorized(res, "Missing authentication token");
      return;
    }

    // 向后兼容：Gateway Token 匹配（开发模式）
    if (config.gatewayToken && token === config.gatewayToken) {
      const authReq = req as AuthenticatedRequest;
      authReq.authContext = {
        authenticated: true,
        role: "admin",
        permissions: ["read", "write", "admin"],
      };
      await next();
      return;
    }

    // 尝试验证 Token
    const authContext = await verifyToken(token, config, discovery, introspection);

    if (!authContext) {
      sendUnauthorized(res, "Invalid or expired token");
      return;
    }

    // 注入 AuthContext
    const authReq = req as AuthenticatedRequest;
    authReq.authContext = authContext;

    await next();
  };
}

/**
 * 验证 Token 并返回 AuthContext
 *
 * 验证策略（jwt-prefer）：
 * 1. token 含 "." → JWT 本地验证（JWKS RS256）
 *    成功 → 解析 claims → 返回 AuthContext
 *    失败 → 降级到 Introspection
 * 2. token 不含 "." 或 JWT 失败 → Introspection
 *    成功（active: true）→ 解析 scope/loginId → 返回 AuthContext
 *    失败 → 返回 null（401）
 *
 * @param token - Bearer Token
 * @param config - OAuth2 配置
 * @param discovery - Discovery 实例
 * @param introspection - Introspection 实例
 * @returns AuthContext 或 null
 */
async function verifyToken(
  token: string,
  config: AuthOAuth2Config,
  discovery: SaTokenDiscovery,
  introspection: SaTokenIntrospection
): Promise<AuthContext | null> {
  const strategy = config.tokenFormat ?? "jwt-prefer";

  // JWT-only 模式
  if (strategy === "jwt-only") {
    return verifyAsJwt(token, config, discovery);
  }

  // Introspection-only 模式
  if (strategy === "introspection-only") {
    return verifyViaIntrospection(token, config, introspection);
  }

  // JWT-prefer 模式（默认）
  if (isJwtToken(token)) {
    try {
      const ctx = await verifyAsJwt(token, config, discovery);
      if (ctx) return ctx;
    } catch (error) {
      if (error instanceof JwtError) {
        console.log(
          `[openclaw-oauth2] JWT validation failed (${error.code}), ` +
          "falling back to introspection"
        );
      }
    }
  }

  // 降级到 Introspection
  return verifyViaIntrospection(token, config, introspection);
}

/**
 * 通过 JWT 验证 Token
 */
async function verifyAsJwt(
  token: string,
  config: AuthOAuth2Config,
  discovery: SaTokenDiscovery
): Promise<AuthContext | null> {
  try {
    const claims = await verifyJwt(token, discovery, config);
    const scopes = parseScopeString(claims.scope);
    const role = mapScopesToRole(scopes, config);
    const permissions = mapScopesToPermissions(scopes, config);

    return {
      authenticated: true,
      role,
      permissions,
      loginId: String(claims.loginId),
      tenantId: claims.tenantId,
      loginType: claims.loginType,
      scopes,
    };
  } catch (error) {
    if (error instanceof JwtError) {
      throw error; // 让调用方决定是否降级
    }
    return null;
  }
}

/**
 * 通过 Introspection 验证 Token
 */
async function verifyViaIntrospection(
  token: string,
  config: AuthOAuth2Config,
  introspection: SaTokenIntrospection
): Promise<AuthContext | null> {
  const result = await introspection.introspect(token);

  if (!result.active) {
    return null;
  }

  const scopes = parseScopeString(result.scope);
  const role = mapScopesToRole(scopes, config);
  const permissions = mapScopesToPermissions(scopes, config);

  return {
    authenticated: true,
    role,
    permissions,
    loginId: result.loginId,
    tenantId: result.tenantId,
    scopes,
  };
}

/**
 * 从请求中提取 Bearer Token
 *
 * 提取顺序：
 * 1. Authorization: Bearer <token>
 * 2. URL 查询参数 ?token=<token>
 *
 * @param req - HTTP 请求
 * @returns Token 字符串或 null
 */
function extractToken(req: IncomingMessage): string | null {
  // 从 Authorization header 提取
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }

  // 从 URL 查询参数提取
  const url = req.url ?? "";
  const queryIdx = url.indexOf("?");
  if (queryIdx >= 0) {
    const params = new URLSearchParams(url.slice(queryIdx + 1));
    const token = params.get("token");
    if (token) return token;
  }

  return null;
}

/**
 * 检查路径是否在跳过列表中
 */
function isSkipPath(path: string, skipPaths: string[]): boolean {
  return skipPaths.some((skip) => path.startsWith(skip));
}

/**
 * 发送 401 Unauthorized 响应
 */
function sendUnauthorized(res: ServerResponse, message: string): void {
  res.writeHead(401, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: message, code: "UNAUTHORIZED" }));
}

/**
 * 创建 withSaTokenAuth 包装器
 * 替换现有 withAuth()，兼容 openclaw_management 的 handler 签名
 *
 * @param handler - 原始处理函数
 * @param requiredPermission - 所需权限
 * @returns 包装后的处理函数
 */
export function withSaTokenAuth(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  requiredPermission?: string
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    const authReq = req as AuthenticatedRequest;

    // 检查 AuthContext 是否存在
    if (!authReq.authContext?.authenticated) {
      sendUnauthorized(res, "Authentication required");
      return;
    }

    // 检查权限
    if (requiredPermission) {
      const hasPermission = authReq.authContext.permissions.includes(
        requiredPermission as "read" | "write" | "admin"
      );
      if (!hasPermission) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: false,
            error: `Insufficient permissions: requires ${requiredPermission}`,
            code: "FORBIDDEN",
          })
        );
        return;
      }
    }

    await handler(req, res);
  };
}
