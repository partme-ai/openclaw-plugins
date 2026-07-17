import { E2E_PORTS } from "../../lib/utils.mjs";

/** @param {import('./mqtt.mjs').ConfigContext} _ctx */
export function tracingConfig(_ctx) {
  return {
    pluginEntry: {
      tracing: {
        enabled: true,
        hooks: {
          allowConversationAccess: true,
        },
        config: {
          enabled: true,
          backend: "otlp",
          otlpEndpoint: `http://127.0.0.1:${E2E_PORTS.otlpHttp}`,
          sampleRate: 1,
          captureMessageBody: false,
          maxSpansPerTrace: 20,
          maxBufferedSpans: 100,
          flushIntervalMs: 100,
          exportTimeoutMs: 5_000,
          exportRetryAttempts: 2,
        },
      },
    },
    channelEntry: {},
  };
}
