/**
 * JWT 验证器单元测试
 *
 * 测试覆盖：
 * - isJwtToken 格式检测
 * - JWT 结构校验
 */

import { describe, it, expect } from "vitest";
import { isJwtToken } from "./satoken-jwt.js";

describe("isJwtToken", () => {
  it("有效 JWT（3 段）应返回 true", () => {
    const token = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dGVzdA";
    expect(isJwtToken(token)).toBe(true);
  });

  it("UUID 风格 Token 应返回 false", () => {
    expect(isJwtToken("550e8400-e29b-41d4-a716-446655440000")).toBe(false);
  });

  it("简单字符串应返回 false", () => {
    expect(isJwtToken("some-opaque-token")).toBe(false);
  });

  it("只有 2 段应返回 false", () => {
    expect(isJwtToken("abc.def")).toBe(false);
  });

  it("空字符串应返回 false", () => {
    expect(isJwtToken("")).toBe(false);
  });

  it("有 4 段应返回 false", () => {
    expect(isJwtToken("a.b.c.d")).toBe(false);
  });
});
