import { describe, it, expect } from "vitest";
import { computeWecomMsgSignature, verifyWecomSignature } from "../src/shared/crypto.js";

describe("computeWecomMsgSignature", () => {
  it("should compute a deterministic SHA1 signature", () => {
    const sig = computeWecomMsgSignature({
      token: "test_token",
      timestamp: "1234567890",
      nonce: "nonce123",
      encrypt: "encrypted_content",
    });
    expect(sig).toBeDefined();
    expect(sig.length).toBe(40); // SHA1 hex length
  });

  it("should be order-independent (sorts params)", () => {
    const sig1 = computeWecomMsgSignature({
      token: "a", timestamp: "b", nonce: "c", encrypt: "d",
    });
    const sig2 = computeWecomMsgSignature({
      token: "a", timestamp: "b", nonce: "c", encrypt: "d",
    });
    expect(sig1).toBe(sig2);
  });
});

describe("verifyWecomSignature", () => {
  it("should verify a valid signature", () => {
    const token = "token123";
    const timestamp = "1700000000";
    const nonce = "nonce456";
    const encrypt = "encrypted_data";

    const sig = computeWecomMsgSignature({ token, timestamp, nonce, encrypt });
    const result = verifyWecomSignature({ token, timestamp, nonce, encrypt, signature: sig });
    expect(result).toBe(true);
  });

  it("should reject an invalid signature", () => {
    const result = verifyWecomSignature({
      token: "token", timestamp: "1", nonce: "2", encrypt: "data", signature: "bad_sig",
    });
    expect(result).toBe(false);
  });
});
