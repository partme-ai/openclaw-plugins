import { describe, expect, it } from "vitest";
import { safeRednodeError } from "../src/shared/safe-error.js";

describe("safeRednodeError", () => {
  it("遮蔽 URL 用户信息、认证字段、实际凭据和控制字符", () => {
    const message = safeRednodeError(
      new Error("https://alice:pass@proxy.test app-key=key-1 app_secret=secret-1 sign=deadbeef Authorization: Bearer bearer-1\n"),
      ["key-1", "secret-1"],
    );
    expect(message).toContain("https://[REDACTED]@proxy.test");
    expect(message).toContain("sign=[REDACTED]");
    expect(message).not.toMatch(/alice:pass|key-1|secret-1|deadbeef|bearer-1|\n/u);
  });

  it("对未知抛出值使用稳定兜底并限制长度", () => {
    expect(safeRednodeError({ secret: true }, [], 32, "failed")).toBe("failed");
    expect(safeRednodeError("x".repeat(100), [], 32)).toHaveLength(32);
  });
});
