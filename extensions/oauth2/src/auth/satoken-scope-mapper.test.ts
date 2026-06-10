/**
 * Scope → OpenClaw 权限映射器单元测试
 *
 * 测试覆盖：
 * - 默认 scope → role 映射
 * - 自定义 scope 映射
 * - 多 scope 优先级规则（admin > operator > viewer）
 * - 空 scope 降级为 viewer
 * - parseScopeString 解析
 */

import { describe, it, expect } from "vitest";
import { mapScopesToRole, mapScopesToPermissions, parseScopeString } from "./satoken-scope-mapper.js";
import type { AuthOAuth2Config } from "../shared/types.js";

describe("mapScopesToRole", () => {
  it("单一 admin scope 应返回 admin 角色", () => {
    expect(mapScopesToRole(["openclaw:admin"])).toBe("admin");
  });

  it("单一 operator scope 应返回 operator 角色", () => {
    expect(mapScopesToRole(["openclaw:operator"])).toBe("operator");
  });

  it("单一 viewer scope 应返回 viewer 角色", () => {
    expect(mapScopesToRole(["openclaw:viewer"])).toBe("viewer");
  });

  it("多个 scope 应取最高优先级：admin > operator > viewer", () => {
    expect(mapScopesToRole(["openclaw:viewer", "openclaw:admin"])).toBe("admin");
    expect(mapScopesToRole(["openclaw:viewer", "openclaw:operator"])).toBe("operator");
    expect(mapScopesToRole(["openclaw:operator", "openclaw:admin", "openclaw:viewer"])).toBe("admin");
  });

  it("空 scope 列表应返回 viewer（最低权限）", () => {
    expect(mapScopesToRole([])).toBe("viewer");
  });

  it("未知 scope 应忽略，返回 viewer", () => {
    expect(mapScopesToRole(["unknown:scope", "other:thing"])).toBe("viewer");
  });

  it("支持自定义 scopeMapping 配置", () => {
    const config: AuthOAuth2Config = {
      issuerUrl: "https://example.com",
      clientId: "test",
      clientSecret: "secret",
      scopeMapping: {
        "custom:superadmin": "admin",
        "custom:user": "operator",
      },
    };
    expect(mapScopesToRole(["custom:superadmin"], config)).toBe("admin");
    expect(mapScopesToRole(["custom:user"], config)).toBe("operator");
    // 默认 scope 在自定义映射下无效
    expect(mapScopesToRole(["openclaw:admin"], config)).toBe("viewer");
  });
});

describe("mapScopesToPermissions", () => {
  it("admin 角色应包含 read/write/admin 权限", () => {
    const perms = mapScopesToPermissions(["openclaw:admin"]);
    expect(perms).toContain("read");
    expect(perms).toContain("write");
    expect(perms).toContain("admin");
  });

  it("operator 角色应包含 read/write 权限", () => {
    const perms = mapScopesToPermissions(["openclaw:operator"]);
    expect(perms).toContain("read");
    expect(perms).toContain("write");
    expect(perms).not.toContain("admin");
  });

  it("viewer 角色应仅包含 read 权限", () => {
    const perms = mapScopesToPermissions(["openclaw:viewer"]);
    expect(perms).toEqual(["read"]);
  });
});

describe("parseScopeString", () => {
  it("应解析空格分隔的 scope 字符串", () => {
    expect(parseScopeString("openclaw:admin openclaw:viewer")).toEqual([
      "openclaw:admin",
      "openclaw:viewer",
    ]);
  });

  it("应处理多个空格", () => {
    expect(parseScopeString("  a   b  c  ")).toEqual(["a", "b", "c"]);
  });

  it("undefined 应返回空数组", () => {
    expect(parseScopeString(undefined)).toEqual([]);
  });

  it("空字符串应返回空数组", () => {
    expect(parseScopeString("")).toEqual([]);
  });
});
