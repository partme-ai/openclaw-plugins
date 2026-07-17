/** WebSocket 管理状态的配置白名单测试。 */
import { describe, expect, it } from "vitest";
import { DEFAULT_WEBSOCKET_CONFIG } from "../src/config.js";
import { buildWebSocketStatusConfig } from "../src/shared/status-snapshot.js";

describe("buildWebSocketStatusConfig", () => {
  it("does not expose tokens, headers, URL query credentials or TLS paths", () => {
    const snapshot = buildWebSocketStatusConfig({
      ...DEFAULT_WEBSOCKET_CONFIG,
      server: {
        ...DEFAULT_WEBSOCKET_CONFIG.server,
        auth: { ...DEFAULT_WEBSOCKET_CONFIG.server.auth, enabled: true, tokens: ["server-secret"] },
        tls: { ...DEFAULT_WEBSOCKET_CONFIG.server.tls, keyFile: "/secret/server.key", certFile: "/secret/server.crt" },
      },
      client: {
        ...DEFAULT_WEBSOCKET_CONFIG.client,
        url: "wss://alice:password@example.com/bridge?token=query-secret",
        token: "client-secret",
        protocols: ["openclaw.v1", "private-protocol-secret"],
        headers: { Authorization: "Bearer header-secret" },
      },
    });
    const serialized = JSON.stringify(snapshot);

    for (const secret of ["server-secret", "client-secret", "query-secret", "password", "private-protocol-secret", "header-secret", "/secret/server.key"]) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).toContain("wss://example.com/bridge");
    expect(serialized).toContain('"protocolCount":2');
    expect(serialized).toContain('"headerCount":1');
  });
});
