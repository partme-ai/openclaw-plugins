export function routerConfig() {
  return {
    pluginEntry: {
      router: {
        enabled: true,
        config: {
          rules: [],
          delivery: { publishTimeoutMs: 5000, initialDelayMs: 100, maxDelayMs: 1000 },
        },
      },
    },
    channelEntry: {},
  };
}
