/**
 * @fileoverview Scope → OpenClaw 权限映射模块。
 *
 * @module oauth2/auth/satoken-scope-mapper
 *
 * 默认映射（可通过 configSchema 覆盖）：
 * - openclaw:admin    → Role admin   （权限: read, write, admin）
 * - openclaw:operator → Role operator（权限: read, write）
 * - openclaw:viewer   → Role viewer  （权限: read）
 *
 * 映射优先级：admin > operator > viewer（同时拥有多个 scope 时取最高角色）
 *
 * 与 OpenClaw 的 Role / Permission 类型保持一致
 */

import type { Role, Permission, AuthOAuth2Config } from "../shared/types.js";

/** 默认 scope → role 映射 */
const DEFAULT_SCOPE_MAPPING: Record<string, string> = {
  "openclaw:admin": "admin",
  "openclaw:operator": "operator",
  "openclaw:viewer": "viewer",
};

/** 角色优先级（越大越高） */
const ROLE_PRIORITY: Record<string, number> = {
  admin: 3,
  operator: 2,
  viewer: 1,
};

/** 角色 → 权限列表映射 */
const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: ["read", "write", "admin"],
  operator: ["read", "write"],
  viewer: ["read"],
};

/**
 * 将 OAuth2 scope 列表映射为 OpenClaw Role
 * 取优先级最高的角色（admin > operator > viewer）
 *
 * @param scopes - OAuth2 scope 列表
 * @param config - OAuth2 配置（包含自定义 scopeMapping）
 * @returns 映射后的角色
 */
export function mapScopesToRole(
  scopes: string[],
  config?: AuthOAuth2Config
): Role {
  const mapping = config?.scopeMapping ?? DEFAULT_SCOPE_MAPPING;

  let highestRole: Role = "viewer";
  let highestPriority = 0;

  for (const scope of scopes) {
    const role = mapping[scope] as Role | undefined;
    if (role) {
      const priority = ROLE_PRIORITY[role] ?? 0;
      if (priority > highestPriority) {
        highestPriority = priority;
        highestRole = role;
      }
    }
  }

  return highestRole;
}

/**
 * 将 OAuth2 scope 列表映射为 OpenClaw Permission 列表
 *
 * @param scopes - OAuth2 scope 列表
 * @param config - OAuth2 配置
 * @returns 权限列表
 */
export function mapScopesToPermissions(
  scopes: string[],
  config?: AuthOAuth2Config
): Permission[] {
  const role = mapScopesToRole(scopes, config);
  return ROLE_PERMISSIONS[role] ?? ["read"];
}

/**
 * 从空格分隔的 scope 字符串解析为数组
 *
 * @param scopeStr - 空格分隔的 scope 字符串
 * @returns scope 数组
 */
export function parseScopeString(scopeStr: string | undefined): string[] {
  if (!scopeStr) return [];
  return scopeStr.split(/\s+/).filter(Boolean);
}
