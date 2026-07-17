import { describe, expect, it } from "vitest";

import { redactStompTcpError } from "../src/shared/redact.js";

describe("redactStompTcpError", () => {
  it("脱敏 URL、passcode、Token 与控制字符", () => {
    const result = redactStompTcpError(
      "tls://user:password@stomp.example?access_token=query-secret passcode=frame-secret\nforged",
    );
    expect(result).not.toMatch(/user:password|query-secret|frame-secret|[\r\n]/);
    expect(result).toContain("[REDACTED]");
  });

  it("ESM 运行时真实复用 OpenClaw 官方云凭据脱敏规则", () => {
    const secret = `AKIA${"A".repeat(16)}`;
    expect(redactStompTcpError(`socket error ${secret}`)).not.toContain(secret);
  });
});
