import { E2E_PORTS } from "../../lib/utils.mjs";

/** 微信 iLink 长轮询的隔离账号配置；私有 Token 由 disposable state helper 写入。 */
export function wechatConfig() {
  return {
    pluginEntry: { "openclaw-weixin": { enabled: true } },
    channelEntry: {
      "openclaw-weixin": {
        accounts: {
          "e2e-im-bot": {
            name: "WeChat E2E",
            enabled: true,
            baseUrl: `http://127.0.0.1:${E2E_PORTS.wechatProvider}`,
            allowCustomApiBaseUrl: true,
          },
        },
      },
    },
  };
}
