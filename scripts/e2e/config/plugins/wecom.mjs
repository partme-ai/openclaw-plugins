import { E2E_PORTS } from "../../lib/utils.mjs";
import { WECOM_AGENT_E2E } from "../../helpers/wecom-provider.mjs";

/**
 * 企业微信 Agent 安装态 E2E 配置。
 *
 * 固定凭据只用于本地生成企业微信标准 AES 密文与 SHA1 签名；测试不会访问企业微信 OpenAPI。
 * Agent 回调采用立即 ACK + 异步 Agent Turn，出站 API 失败不影响入站链路与去重断言。
 */
export const WECOM_E2E_CONFIG = {
  enabled: true,
  dmPolicy: "open",
  allowFrom: ["*"],
  groupPolicy: "disabled",
  agent: {
    enabled: true,
    corpId: WECOM_AGENT_E2E.corpId,
    corpSecret: WECOM_AGENT_E2E.corpSecret,
    apiBaseUrl: `http://127.0.0.1:${E2E_PORTS.wecomProvider}`,
    agentId: 1000002,
    token: "wecom-e2e-callback-token",
    encodingAESKey: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
    dmPolicy: "open",
    allowFrom: ["*"],
  },
  network: { agentReplyTimeoutMs: 30_000 },
};

/** WeCom 是 channel 插件：入口开关和业务参数分别写入 plugins/channels。 */
export function wecomConfig() {
  return {
    pluginEntry: { wecom: { enabled: true } },
    channelEntry: { wecom: WECOM_E2E_CONFIG },
  };
}
