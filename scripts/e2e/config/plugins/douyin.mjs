/**
 * 抖音安装态 E2E 配置。
 *
 * 使用固定测试凭据只为生成/校验 Webhook SHA1；不会访问抖音生产 OpenAPI。
 * `dmPolicy=open` 让测试事件进入真实 Agent Turn，安全拒绝由独立请求覆盖。
 */
export const DOUYIN_E2E_CONFIG = {
  enabled: true,
  app_key: "douyin-e2e-client-key",
  app_secret: "douyin-e2e-app-secret",
  account_id: "douyin-e2e-account",
  webhook_path: "/channels/douyin/e2e-webhook",
  dmPolicy: "open",
  allowFrom: ["*"],
  network: { agentReplyTimeoutMs: 30_000 },
};

/** 抖音是 channel 插件：插件入口只负责启用，业务参数写入 channels.douyin。 */
export function douyinConfig() {
  return {
    pluginEntry: { douyin: { enabled: true } },
    channelEntry: { douyin: DOUYIN_E2E_CONFIG },
  };
}
