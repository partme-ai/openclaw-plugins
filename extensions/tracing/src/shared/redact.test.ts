import { describe, expect, it } from "vitest";
import { redactTraceText, sanitizeTraceAttributes } from "./redact.js";

describe("tracing sensitive data boundary", () => {
  it("redacts credentials and bounds exported text", () => {
    const value = redactTraceText(`Bearer private-token\n${"x".repeat(600)}`);
    expect(value).not.toContain("private-token");
    expect(value).not.toContain("\n");
    expect(value.length).toBeLessThanOrEqual(500);
  });

  it("replaces business identifiers with stable in-process correlation tokens", () => {
    const first = sanitizeTraceAttributes({
      "openclaw.session_key": "customer@example.com",
      "openclaw.message_text": "use sk-secretvalue123 now",
    });
    const second = sanitizeTraceAttributes({ "openclaw.session_key": "customer@example.com" });

    expect(first["openclaw.session_key"]).toBe(second["openclaw.session_key"]);
    expect(first["openclaw.session_key"]).toMatch(/^id_[a-f0-9]{24}$/);
    expect(first["openclaw.session_key"]).not.toContain("customer");
    expect(first["openclaw.message_text"]).not.toContain("secretvalue123");
  });
});
