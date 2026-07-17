import { describe, expect, it } from "vitest";

import { DEFAULT_RABBITMQ_CONFIG } from "../src/config.js";
import { redactRabbitmqError } from "../src/shared/redact.js";

describe("redactRabbitmqError", () => {
  it("masks configured and arbitrary AMQP URL credentials", () => {
    const config = { ...DEFAULT_RABBITMQ_CONFIG, url: "amqps://alice:secret@rabbit.example/vhost" };
    const result = redactRabbitmqError(
      new Error("connect amqps://alice:secret@rabbit.example/vhost via amqp://bob:password@backup.example"),
      config,
    );

    expect(result).not.toContain("alice");
    expect(result).not.toContain("secret");
    expect(result).not.toContain("bob");
    expect(result).not.toContain("password");
    expect(result).toContain("[REDACTED]");
  });

  it("removes control characters and caps broker messages", () => {
    const result = redactRabbitmqError(`bad\nline\u0000${"x".repeat(700)}`);
    expect(result).not.toMatch(/[\u0000-\u001f\u007f]/u);
    expect(result.length).toBe(500);
  });

  it("ESM 运行时复用 OpenClaw 官方云凭据脱敏规则", () => {
    const secret = `AKIA${"A".repeat(16)}`;
    expect(redactRabbitmqError(`connect failed ${secret}`)).not.toContain(secret);
  });
});
