import { describe, expect, it } from "vitest";
import { safeMeituanError } from "../src/shared/safe-error.js";

describe("safeMeituanError", () => {
  it("遮蔽 URL 用户信息、认证字段、实际凭据和控制字符", () => {
    const message = safeMeituanError(
      new Error("https://alice:pass@proxy.test signKey=secret-key Authorization: Bearer bearer-1\nDeveloper 123456"),
      ["secret-key", "123456"],
    );
    expect(message).toContain("https://[REDACTED]@proxy.test");
    expect(message).toContain("signKey=[REDACTED]");
    expect(message).not.toMatch(/alice:pass|secret-key|bearer-1|123456|\n/u);
  });

  it("对未知抛出值使用稳定兜底并限制长度", () => {
    expect(safeMeituanError({ secret: true }, [], 32, "failed")).toBe("failed");
    expect(safeMeituanError("x".repeat(100), [], 32)).toHaveLength(32);
  });
});
