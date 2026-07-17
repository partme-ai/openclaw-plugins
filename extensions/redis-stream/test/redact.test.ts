import { describe, expect, it } from "vitest";

import { DEFAULT_REDIS_CHANNEL_CONFIG } from "../src/config.js";
import { redactRedisError } from "../src/shared/redact.js";

describe("redactRedisError", () => {
  it("masks configured and arbitrary Redis URL credentials", () => {
    const config = {
      ...DEFAULT_REDIS_CHANNEL_CONFIG,
      url: "rediss://alice:secret@redis.example:6380",
    };
    const result = redactRedisError(
      new Error("connect rediss://alice:secret@redis.example:6380 via redis://bob:password@backup.example"),
      config,
    );
    expect(result).not.toContain("alice");
    expect(result).not.toContain("secret");
    expect(result).not.toContain("bob");
    expect(result).not.toContain("password");
    expect(result).toContain("[REDACTED]");
  });

  it("removes control characters and caps third-party messages", () => {
    const result = redactRedisError(`bad\nline\u0000${"x".repeat(700)}`);
    expect(result).not.toMatch(/[\u0000-\u001f\u007f]/u);
    expect(result.length).toBe(500);
  });
});
