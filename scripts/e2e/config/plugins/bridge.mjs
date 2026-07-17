/** Bridge 安装态配置：把 MQTT 入站和 Agent 出站镜像到独立审计 Topic。 */
export function bridgeConfig() {
  return {
    pluginEntry: {
      bridge: {
        enabled: true,
        config: {
          channels: {
            mqtt: {
              enabled: true,
              forwardToMq: true,
              mqChannel: "mqtt",
              topicPrefix: "openclaw/bridge/mqtt",
            },
          },
          delivery: {
            maxAttempts: 3,
            retryDelayMs: 50,
            publishTimeoutMs: 5_000,
            maxPayloadBytes: 1_048_576,
            maxInFlight: 2,
            maxBufferedMessages: 100,
            shutdownTimeoutMs: 5_000,
          },
        },
      },
    },
    channelEntry: {},
  };
}
