import { describe, expect, it } from "vitest";

import { toSafeErrorSummary } from "./safe-log.js";

describe("toSafeErrorSummary", () => {
  it("redacts URL credentials, query parameters and control characters", () => {
    const summary = toSafeErrorSummary(
      new Error("request https://user:pass@example.com/api?access_token=secret\nfailed"),
    );

    expect(summary).toContain("https://example.com/api?REDACTED");
    expect(summary).not.toContain("user:pass");
    expect(summary).not.toContain("secret");
    expect(summary).not.toContain("\n");
  });

  it("bounds untrusted error text", () => {
    expect(toSafeErrorSummary("x".repeat(2_000)).length).toBe(512);
  });
});
