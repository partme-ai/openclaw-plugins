import type { AuthOAuth2Config, Permission, Role } from "../shared/types.js";

const DEFAULT_SCOPE_MAPPING: Record<string, string> = {
  "openclaw:admin": "admin",
  "openclaw:operator": "operator",
  "openclaw:viewer": "viewer",
};
const ROLE_PRIORITY: Record<Role, number> = { admin: 3, operator: 2, viewer: 1 };
const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: ["read", "write", "admin"],
  operator: ["read", "write"],
  viewer: ["read"],
};

export function mapScopesToRole(
  scopes: string[],
  config?: Pick<AuthOAuth2Config, "scopeMapping">,
): Role {
  const mapping = config?.scopeMapping ?? DEFAULT_SCOPE_MAPPING;
  return scopes.reduce<Role>((highest, scope) => {
    const candidate = mapping[scope] as Role | undefined;
    return candidate && ROLE_PRIORITY[candidate] > ROLE_PRIORITY[highest] ? candidate : highest;
  }, "viewer");
}

export function mapScopesToPermissions(
  scopes: string[],
  config?: Pick<AuthOAuth2Config, "scopeMapping">,
): Permission[] {
  return ROLE_PERMISSIONS[mapScopesToRole(scopes, config)];
}

export function parseScopeString(scope: string | undefined): string[] {
  return scope?.split(/\s+/).filter(Boolean) ?? [];
}
