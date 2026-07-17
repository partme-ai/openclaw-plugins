import { E2E_PORTS } from "../../lib/utils.mjs";

/**
 * 微信 iPad 桥接安装态配置。
 * 风险确认只作用于一次性本地夹具；测试不会连接微信网络或任何真实非官方协议服务。
 */
export function wechatIpadConfig() {
  const config = {
    enabled: true,
    acknowledgeUnofficialProtocolRisk: true,
    required: true,
    serviceUrl: `ws://127.0.0.1:${E2E_PORTS.wechatIpadProvider}`,
    apiUrl: `http://127.0.0.1:${E2E_PORTS.wechatIpadProvider}`,
    auth: { token: "wechat-ipad-e2e-token" },
    network: { heartbeatIntervalMs: 60_000, pongTimeoutMs: 10_000 },
    message: {
      dmPolicy: "allowlist",
      allowFrom: ["wxid_e2e_user"],
      commandAllowFrom: [],
      maxPendingMessages: 32,
    },
  };
  return {
    // OpenClaw 把插件私有 schema 绑定到 entries.<id>.config；Channel 段供渠道配置解析与状态命令读取。
    pluginEntry: { "wechat-ipad": { enabled: true, config } },
    channelEntry: {
      "wechat-ipad": config,
    },
  };
}
