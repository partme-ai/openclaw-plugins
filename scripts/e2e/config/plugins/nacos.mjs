import {
  NACOS_E2E_DATA_ID,
  NACOS_E2E_SERVICE,
} from "../../bootstrap/nacos-config.mjs";
import { E2E_PORTS } from "../../lib/utils.mjs";

/**
 * Nacos 真实服务 E2E 配置。
 *
 * 固定注册回环地址可验证自节点过滤；共享配置开启 refresh 可验证
 * Nacos Config 长轮询 → 合并 → 备份 → OpenClaw 原子替换的完整链路。
 */
export function nacosConfig() {
  return {
    pluginEntry: {
      nacos: {
        enabled: true,
        config: {
          enabled: true,
          startupFailurePolicy: "fail",
          serverList: `127.0.0.1:${E2E_PORTS.nacosHttp}`,
          registerIp: "127.0.0.1",
          serviceName: NACOS_E2E_SERVICE,
          metadata: { e2eRevision: "local" },
          configCenter: {
            enabled: true,
            sharedConfigs: [{ dataId: NACOS_E2E_DATA_ID, refresh: true }],
          },
          clusterDiscovery: { enabled: true },
        },
      },
    },
    channelEntry: {},
  };
}
