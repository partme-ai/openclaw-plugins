import { describe, expect, it } from "vitest";

import { redactBridgeError } from "../../src/bridge/redact.js";

describe("redactBridgeError", () => {
  it("脱敏 URL 用户信息、认证头、查询参数与常见密钥字段", () => {
    const result = redactBridgeError(new Error(
      "mqtt://bridge-user:bridge-password@broker.local?access_token=query-secret " +
      "Authorization: Bearer bearer-secret client_secret=client-secret",
    ));
    expect(result).not.toMatch(/bridge-password|query-secret|bearer-secret|client-secret/);
    expect(result).toContain("[REDACTED]");
  });

  it("移除控制字符并限制日志诊断长度", () => {
    const result = redactBridgeError(`failed\nforged\r${"x".repeat(800)}`);
    expect(result).not.toMatch(/[\r\n]/);
    expect(result.length).toBeLessThanOrEqual(500);
  });
});
