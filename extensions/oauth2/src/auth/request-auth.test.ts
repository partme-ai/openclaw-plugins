import type { IncomingMessage } from "node:http";

import { describe, expect, it } from "vitest";

import { extractBearerToken } from "./request-auth.js";

function request(authorization?: string): IncomingMessage {
  return { headers: { authorization } } as IncomingMessage;
}

describe("extractBearerToken", () => {
  it("accepts the case-insensitive Bearer scheme", () => {
    expect(extractBearerToken(request("bearer access-token"))).toBe("access-token");
    expect(extractBearerToken(request("BEARER\taccess-token"))).toBe("access-token");
  });

  it("rejects empty, comma-joined, and whitespace-containing credentials", () => {
    expect(extractBearerToken(request("Bearer"))).toBeNull();
    expect(extractBearerToken(request("Bearer token, Bearer other"))).toBeNull();
    expect(extractBearerToken(request("Bearer token with-space"))).toBeNull();
  });
});
