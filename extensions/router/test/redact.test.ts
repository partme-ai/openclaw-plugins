import { describe, expect, it } from "vitest";

import { redactRouterError } from "../src/redact.js";

describe("redactRouterError", () => {
  it("脱敏 URL、认证头、查询参数和常见密钥字段", () => {
    const result = redactRouterError(new Error(
      "https://alice:pw-123@broker.example.com/send?access_token=query-secret " +
      "Authorization: Bearer bearer-secret client_secret=json-secret X-Gotify-Key: gotify-secret",
    ));

    expect(result).not.toMatch(/pw-123|query-secret|bearer-secret|json-secret|gotify-secret/);
    expect(result).toContain("[REDACTED]");
  });

  it("压平控制字符并限制持久诊断长度", () => {
    const result = redactRouterError(`first\nforged\r${"x".repeat(800)}`);
    expect(result).not.toMatch(/[\r\n]/);
    expect(result.length).toBeLessThanOrEqual(500);
  });
});
