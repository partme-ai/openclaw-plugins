/** @param {{ gotifySecrets?: Record<string, unknown> }} ctx */
export function gotifyConfig(ctx) {
  const g = ctx.gotifySecrets ?? {};
  return {
    pluginEntry: { gotify: { enabled: true } },
    channelEntry: {
      gotify: {
        defaultAccount: "e2e",
        accounts: {
          e2e: {
            name: "e2e",
            enabled: true,
            serverUrl: g.serverUrl,
            appToken: g.appToken,
            clientToken: g.clientToken,
            dmPolicy: "open",
            allowFrom: ["*"],
            inbound: {
              enabled: true,
              allowedAppId: g.allowedAppId,
              deleteAfterConsume: false,
            },
          },
        },
      },
    },
  };
}
