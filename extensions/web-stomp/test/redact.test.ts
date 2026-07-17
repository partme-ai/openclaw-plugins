import { describe, expect, it } from "vitest";

import { redactWebStompError } from "../src/shared/redact.js";

describe("redactWebStompError", () => {
  it("脱敏 URL、passcode、Token 与控制字符", () => {
    const result = redactWebStompError(
      "wss://user:password@stomp.example/ws?access_token=query-secret passcode=frame-secret\nforged",
    );
    expect(result).not.toMatch(/user:password|query-secret|frame-secret|[\r\n]/);
    expect(result).toContain("[REDACTED]");
  });

  it("复用 OpenClaw 官方规则脱敏常见云凭据", () => {
    const accessKey = `AKIA${"A".repeat(16)}`;
    const result = redactWebStompError(`upstream rejected aws_access_key_id=${accessKey}`);
    expect(result).not.toContain(accessKey);
  });
});
