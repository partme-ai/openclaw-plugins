export function redisStreamConfig() {
  const config = {
    url: "redis://127.0.0.1:6379",
    channelMode: "stream",
    defaultAgentId: "main",
    stream: {
      inboundKey: "openclaw-e2e:inbound",
      outboundKey: "openclaw-e2e:outbound",
      deadLetterKey: "openclaw-e2e:dlq",
      consumerGroup: "openclaw-e2e",
      consumerName: `gateway-${process.pid}`,
      // 必须长于 Agent 回复超时，防止 E2E 中仍在执行的 Turn 被其他消费者提前回收。
      pendingClaimIdleMs: 180000,
      maxAttempts: 3,
    },
  };
  return {
    pluginEntry: { "redis-stream": { enabled: true, config } },
    channelEntry: {
      "redis-stream": config,
    },
  };
}
