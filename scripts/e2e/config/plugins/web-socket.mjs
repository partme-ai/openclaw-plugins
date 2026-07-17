/** @param {import('./mqtt.mjs').ConfigContext} ctx */
export function webSocketConfig(ctx) {
  const testWebPort = Number(process.env.E2E_TEST_WEB_PORT ?? 8765);
  return {
    pluginEntry: { "web-socket": { enabled: true } },
    channelEntry: {
      "web-socket": {
        enabled: true,
        mode: "server",
        host: "127.0.0.1",
        wsPort: Number(process.env.E2E_WEB_SOCKET_PORT ?? 28789),
        path: "/openclaw/ws",
        defaultAgentId: "main",
        allowedOrigins: ["https://e2e.openclaw.local", `http://127.0.0.1:${testWebPort}`],
        auth: {
          enabled: true,
          token: "openclaw-web-socket-e2e-token",
          allowQueryToken: false,
          allowProtocolToken: true,
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
