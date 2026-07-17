import { describe, expect, it } from "vitest";
import { DEFAULT_ROCKERMQ_CONFIG } from "../src/config.js";
import { redactRocketmqError } from "../src/shared/redact.js";

describe("redactRocketmqError", () => {
  it("masks configured ACL credentials and sanitizes control characters", () => {
    const config = {
      ...DEFAULT_ROCKERMQ_CONFIG,
      sessionCredentials: {
        accessKey: "ak-prod",
        accessSecret: "secret-prod",
        securityToken: "token-prod",
      },
    };
    const result = redactRocketmqError(
      new Error("accessKey=ak-prod accessSecret:secret-prod token-prod\nnext"),
      config,
    );
    expect(result).not.toContain("ak-prod");
    expect(result).not.toContain("secret-prod");
    expect(result).not.toContain("token-prod");
    expect(result).not.toContain("\n");
  });
});
