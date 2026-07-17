/** MQTT 外部错误脱敏边界测试。 */
import { describe, expect, it } from "vitest";
import { DEFAULT_BROKER_CONFIG } from "../src/config.js";
import { redactMqttError } from "../src/shared/redact.js";

describe("redactMqttError", () => {
  it("hides configured and URI credentials and removes control characters", () => {
    const config = {
      ...DEFAULT_BROKER_CONFIG,
      auth: {
        enabled: true,
        allowAnonymous: false,
        users: [{ username: "device", password: "device-secret" }],
      },
      persistence: {
        enabled: true,
        backend: "redis" as const,
        redis: { password: "redis-secret" },
      },
    };

    const safe = redactMqttError(
      "device-secret redis-secret mongodb://admin:mongo-secret@db/prod Bearer token-value\nnext",
      config,
    );

    expect(safe).not.toContain("device-secret");
    expect(safe).not.toContain("redis-secret");
    expect(safe).not.toContain("mongo-secret");
    expect(safe).not.toContain("token-value");
    expect(safe).not.toContain("\n");
    expect(safe).toContain("[REDACTED]");
  });

  it("ESM 运行时真实调用 OpenClaw security-runtime", () => {
    const secret = "AKIAABCDEFGHIJKLMNOP";
    expect(redactMqttError(`broker error ${secret}`)).not.toContain(secret);
  });
});
