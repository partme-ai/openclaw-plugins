import { describe, expect, it } from "vitest";

import { DEFAULT_WEBSOCKET_CONFIG } from "../src/config.js";
import { redactWebSocketError } from "../src/shared/redact.js";

describe("redactWebSocketError", () => {
  it("masks configured credentials, URL userinfo and Bearer tokens", () => {
    const config = {
      ...DEFAULT_WEBSOCKET_CONFIG,
      server: {
        ...DEFAULT_WEBSOCKET_CONFIG.server,
        auth: { ...DEFAULT_WEBSOCKET_CONFIG.server.auth, tokens: ["server-secret"] },
      },
      client: {
        ...DEFAULT_WEBSOCKET_CONFIG.client,
        token: "client-secret",
        headers: { "X-Api-Key": "header-secret" },
      },
    };
    const result = redactWebSocketError(
      new Error("wss://alice:password@example.com Bearer leaked server-secret client-secret header-secret"),
      config,
    );

    expect(result).not.toContain("alice");
    expect(result).not.toContain("password");
    expect(result).not.toContain("leaked");
    expect(result).not.toContain("server-secret");
    expect(result).not.toContain("client-secret");
    expect(result).not.toContain("header-secret");
    expect(result).toContain("[REDACTED]");
  });

  it("removes control characters and caps third-party messages", () => {
    const result = redactWebSocketError(`bad\nline\u0000${"x".repeat(700)}`);
    expect(result).not.toMatch(/[\u0000-\u001f\u007f]/u);
    expect(result.length).toBe(500);
  });
});
