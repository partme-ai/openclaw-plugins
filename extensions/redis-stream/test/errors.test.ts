/** Redis Stream 错误对象的敏感信息边界测试。 */
import { describe, expect, it } from "vitest";
import { RedisConnectionError } from "../src/shared/errors.js";

describe("RedisConnectionError", () => {
  it("redacts Redis ACL credentials from both message and structured url", () => {
    const error = new RedisConnectionError(
      "rediss://secret-user:secret-pass@redis.example.com:6380",
      "connection refused",
    );

    expect(error.message).not.toContain("secret-user");
    expect(error.message).not.toContain("secret-pass");
    expect(error.url).not.toContain("secret-user");
    expect(error.url).not.toContain("secret-pass");
    expect(error.url).toContain("redis.example.com");
  });
});
