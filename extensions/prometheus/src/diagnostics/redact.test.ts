/**
 * Prometheus 最终脱敏边界回归测试。
 *
 * AWS Access Key 由 OpenClaw security-runtime 识别，本地 exporter 规则并不匹配它，因此该
 * 用例同时证明 ESM 运行时确实调用了官方脱敏器，而不是静默退化到旧的 require fallback。
 */
import { describe, expect, it } from "vitest";
import { redactSensitiveText } from "./redact.js";

describe("redactSensitiveText", () => {
  it("使用 OpenClaw security-runtime 隐藏云凭据", () => {
    const secret = "AKIAABCDEFGHIJKLMNOP";
    const output = redactSensitiveText(`provider failed with ${secret}`);

    expect(output).not.toContain(secret);
  });

  it("叠加隐藏常见 Authorization 与配置字段", () => {
    const output = redactSensitiveText(
      "Authorization: Basic opaque-basic-value client_secret=oauth-secret password=db-secret",
    );

    expect(output).not.toContain("opaque-basic-value");
    expect(output).not.toContain("oauth-secret");
    expect(output).not.toContain("db-secret");
  });
});
