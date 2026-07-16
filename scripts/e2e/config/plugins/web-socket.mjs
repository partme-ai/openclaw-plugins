/** @param {import('./mqtt.mjs').ConfigContext} ctx */
export function webSocketConfig(ctx) {
  return {
    pluginEntry: { "web-socket": { enabled: true } },
    channelEntry: {
      "web-socket": {
        enabled: true,
        mode: "server",
        host: "127.0.0.1",
        wsPort: Number(process.env.E2E_WEB_SOCKET_PORT ?? 28789),
        path: "/openclaw/ws",
        allowedOrigins: ["https://e2e.openclaw.local"],
        auth: {
          enabled: true,
          token: "openclaw-web-socket-e2e-token",
          allowQueryToken: false,
        },
        limits: {
          heartbeatIntervalMs: 2_000,
          heartbeatTimeoutMs: 1_000,
          maxPayloadBytes: 65_536,
          maxBufferedBytes: 65_536,
          maxPendingMessages: 8,
          messagesPerMinute: 60,
        },
      },
    },
  };
}
