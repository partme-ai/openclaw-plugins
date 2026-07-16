export function redisStreamConfig() {
  return {
    pluginEntry: { "redis-stream": { enabled: true } },
    channelEntry: {
      "redis-stream": {
        url: "redis://127.0.0.1:6379",
        channelMode: "stream",
        defaultAgentId: "main",
        stream: {
          inboundKey: "openclaw-e2e:inbound",
          outboundKey: "openclaw-e2e:outbound",
          deadLetterKey: "openclaw-e2e:dlq",
          consumerGroup: "openclaw-e2e",
          consumerName: `gateway-${process.pid}`,
          pendingClaimIdleMs: 1000,
          maxAttempts: 3,
        },
      },
    },
  };
}
