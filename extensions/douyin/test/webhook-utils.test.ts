import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { tryParseVerifyWebhookChallenge, verifyDouyinSignature, extractDouyinSenderId } from "../src/webhook-utils.js";

describe("tryParseVerifyWebhookChallenge", () => {
  it("returns challenge string for verify_webhook event", () => {
    const body = JSON.stringify({ event: "verify_webhook", content: { challenge: 12345 } });
    expect(tryParseVerifyWebhookChallenge(body)).toBe("12345");
  });

  it("returns challenge when it's already a string", () => {
    const body = JSON.stringify({ event: "verify_webhook", content: { challenge: "abc123" } });
    expect(tryParseVerifyWebhookChallenge(body)).toBe("abc123");
  });

  it("returns null for non-verify_webhook events", () => {
    const body = JSON.stringify({ event: "message", content: { text: "hello" } });
    expect(tryParseVerifyWebhookChallenge(body)).toBeNull();
  });

  it("returns null when content is null", () => {
    const body = JSON.stringify({ event: "verify_webhook", content: null });
    expect(tryParseVerifyWebhookChallenge(body)).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(tryParseVerifyWebhookChallenge("not json")).toBeNull();
  });

  it("returns null when challenge is absent", () => {
    const body = JSON.stringify({ event: "verify_webhook", content: {} });
    expect(tryParseVerifyWebhookChallenge(body)).toBeNull();
  });
});

describe("verifyDouyinSignature", () => {
  it("returns true for valid SHA1 signature", () => {
    const secret = "test-secret";
    const body = "hello world";
    const expected = createHash("sha1").update(secret + body, "utf8").digest("hex");
    expect(verifyDouyinSignature(secret, body, expected)).toBe(true);
  });

  it("returns false for invalid signature", () => {
    expect(verifyDouyinSignature("secret", "body", "bad-sig")).toBe(false);
  });

  it("returns false when signature header is undefined", () => {
    expect(verifyDouyinSignature("secret", "body", undefined)).toBe(false);
  });

  it("returns false for empty signature header", () => {
    expect(verifyDouyinSignature("secret", "body", "")).toBe(false);
  });

  it("is case-sensitive", () => {
    const secret = "test";
    const body = "data";
    const sig = createHash("sha1").update(secret + body, "utf8").digest("hex");
    expect(verifyDouyinSignature(secret, body, sig.toUpperCase())).toBe(false);
  });
});

describe("extractDouyinSenderId", () => {
  it("extracts from_user_id from content", () => {
    const body = JSON.stringify({ content: { from_user_id: "user-123" } });
    expect(extractDouyinSenderId(body)).toBe("user-123");
  });

  it("extracts user_id from content", () => {
    const body = JSON.stringify({ content: { user_id: "user-456" } });
    expect(extractDouyinSenderId(body)).toBe("user-456");
  });

  it("extracts user_open_id from content", () => {
    const body = JSON.stringify({ content: { user_open_id: "open-789" } });
    expect(extractDouyinSenderId(body)).toBe("open-789");
  });

  it("extracts open_id from content", () => {
    const body = JSON.stringify({ content: { open_id: "oid-000" } });
    expect(extractDouyinSenderId(body)).toBe("oid-000");
  });

  it("falls back to top-level from_user_id", () => {
    const body = JSON.stringify({ from_user_id: "top-user" });
    expect(extractDouyinSenderId(body)).toBe("top-user");
  });

  it("returns null when no sender ID found", () => {
    const body = JSON.stringify({ content: { text: "hello" } });
    expect(extractDouyinSenderId(body)).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(extractDouyinSenderId("not json")).toBeNull();
  });

  it("returns null for empty string sender", () => {
    const body = JSON.stringify({ content: { from_user_id: "" } });
    expect(extractDouyinSenderId(body)).toBeNull();
  });
});
