import { describe, expect, it } from "vitest";

import {
  isClientModeEnabled,
  isServerModeEnabled,
  isWebsocketChannelConfigured,
  resolveWebsocketConfig,
  validateWebsocketConfig,
} from "../src/config.js";

describe("resolveWebsocketConfig", () => {
  it("parses server mode with nested and flat fields", () => {
    const cfg = resolveWebsocketConfig({
      channels: {
        "web-socket": {
          mode: "server",
          wsPort: 19000,
          path: "/ws/chat",
          defaultAgentId: "main-agent",
          auth: { enabled: true, token: "secret-one" },
        },
      },
    });

    expect(cfg.mode).toBe("server");
    expect(cfg.server.wsPort).toBe(19000);
    expect(cfg.server.path).toBe("/ws/chat");
    expect(cfg.server.auth.enabled).toBe(true);
    expect(isServerModeEnabled(cfg)).toBe(true);
    expect(isClientModeEnabled(cfg)).toBe(false);
  });

  it("parses client mode url and reconnect", () => {
    const cfg = resolveWebsocketConfig({
      channels: {
        "web-socket": {
          mode: "client",
          url: "wss://gateway.example/ws",
          clientToken: "tok",
          clientId: "bridge-1",
          client: {
            reconnect: { enabled: false, initialDelayMs: 500, maxDelayMs: 5000 },
          },
        },
      },
    });

    expect(cfg.mode).toBe("client");
    expect(cfg.client.url).toBe("wss://gateway.example/ws");
    expect(cfg.client.token).toBe("tok");
    expect(cfg.client.clientId).toBe("bridge-1");
    expect(cfg.client.reconnect.enabled).toBe(false);
    expect(isClientModeEnabled(cfg)).toBe(true);
  });

  it("uses defaults when section missing", () => {
    const cfg = resolveWebsocketConfig({});
    expect(cfg.mode).toBe("server");
    expect(cfg.server.wsPort).toBe(18789);
    expect(cfg.server.host).toBe("127.0.0.1");
    expect(cfg.server.auth.allowQueryToken).toBe(false);
  });

  it("rejects an anonymous or implicit remote plaintext listener", () => {
    const anonymous = resolveWebsocketConfig({ channels: { "web-socket": { host: "0.0.0.0" } } });
    expect(() => validateWebsocketConfig(anonymous)).toThrow(/requires server\.auth/);
    const authenticated = resolveWebsocketConfig({
      channels: { "web-socket": { host: "0.0.0.0", auth: { enabled: true, token: "secret" } } },
    });
    expect(() => validateWebsocketConfig(authenticated)).toThrow(/allowInsecureRemote/);
  });

  it("rejects a remote ws client unless explicitly allowed", () => {
    const cfg = resolveWebsocketConfig({ channels: { "web-socket": { mode: "client", url: "ws://example.com/ws" } } });
    expect(() => validateWebsocketConfig(cfg)).toThrow(/remote plaintext client/);
  });
});

describe("isWebsocketChannelConfigured", () => {
  it("requires url for client mode", () => {
    expect(isWebsocketChannelConfigured({ mode: "client" })).toBe(false);
    expect(
      isWebsocketChannelConfigured({ mode: "client", url: "ws://localhost/ws" }),
    ).toBe(true);
  });
});
