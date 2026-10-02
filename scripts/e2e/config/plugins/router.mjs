export function routerConfig() {
  return {
    pluginEntry: {
      router: {
        enabled: true,
        config: {
          ...(process.env.OPENCLAW_E2E_STRUCTURED_WIRE === "1" ? {
            structured: { enabled: true, allowedMediaHosts: ["raw.githubusercontent.com"] },
            rules: [{ id: "o3-mqtt-media", match: { channels: ["mqtt"], direction: "inbound" }, actions: [
              { type: "forward", target: "wecom", topic: "user:o3-recipient", payloadFormat: "structured-v1" },
            ] }],
          } : { rules: [] }),
          delivery: { publishTimeoutMs: 5000, initialDelayMs: 100, maxDelayMs: 1000 },
        },
      },
    },
    channelEntry: {},
  };
}
