import { E2E_PORTS } from "../../lib/utils.mjs";
import { WECOM_KF_E2E } from "../../helpers/wecom-kf-provider.mjs";

/** 企业微信客服 tarball 安装态配置；全部凭据只指向本机隔离夹具。 */
export function wecomKfConfig() {
  return {
    pluginEntry: { "wecom-kf": { enabled: true } },
    channelEntry: {
      "wecom-kf": {
        enabled: true,
        webhookPath: "/wecom/kf",
        apiBaseUrl: `http://127.0.0.1:${E2E_PORTS.wecomKfProvider}`,
        corpId: WECOM_KF_E2E.corpId,
        corpSecret: WECOM_KF_E2E.corpSecret,
        token: WECOM_KF_E2E.token,
        encodingAESKey: WECOM_KF_E2E.encodingAESKey,
        openKfId: WECOM_KF_E2E.openKfId,
        agentId: "main",
      },
    },
  };
}
