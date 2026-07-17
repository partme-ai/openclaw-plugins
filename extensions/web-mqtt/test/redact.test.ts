/** Web-MQTT 对外错误脱敏测试。 */
import { describe, expect, it } from "vitest";
import { redactWebMqttError } from "../src/shared/redact.js";

describe("redactWebMqttError", () => {
  it("hides configured credentials and control characters", () => {
    const config = {
      auth: {
        users: [{ username: "browser", password: "browser-secret", passwordHash: undefined }],
      },
    } as never;
    const safe = redactWebMqttError("browser-secret Bearer external-token\nnext", config);
    expect(safe).not.toContain("browser-secret");
    expect(safe).not.toContain("external-token");
    expect(safe).not.toContain("\n");
    expect(safe).toContain("[REDACTED]");
  });

  it("ESM 运行时真实调用 OpenClaw security-runtime", () => {
    const secret = "AKIAABCDEFGHIJKLMNOP";
    expect(redactWebMqttError(`websocket error ${secret}`)).not.toContain(secret);
  });
});
