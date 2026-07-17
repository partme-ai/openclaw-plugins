import { describe, expect, it } from "vitest";
import { safeWechatIpadError } from "../src/shared/safe-error.js";

describe("safeWechatIpadError", () => {
  it("遮蔽 URL 用户信息、认证字段、真实 Token 和控制字符", () => {
    const message = safeWechatIpadError(
      new Error("https://alice:pass@bridge.test Authorization: Bearer bearer-1 token=token-1\n"),
      ["token-1"],
    );
    expect(message).toContain("https://[REDACTED]@bridge.test");
    expect(message).not.toMatch(/alice:pass|bearer-1|token-1|\n/u);
  });

  it("对未知值使用固定兜底并限制长度", () => {
    expect(safeWechatIpadError({ token: "x" }, [], 32, "failed")).toBe("failed");
    expect(safeWechatIpadError("x".repeat(100), [], 32)).toHaveLength(32);
  });
});
