import { E2E_PORTS } from "../lib/utils.mjs";

export const NACOS_E2E_DATA_ID = "openclaw-e2e-shared.json";
export const NACOS_E2E_GROUP = "DEFAULT_GROUP";
export const NACOS_E2E_SERVICE = "openclaw-gateway-e2e";

const CONFIG_API = `http://127.0.0.1:${E2E_PORTS.nacosHttp}/nacos/v1/cs/configs`;

/** 生成只覆盖插件 metadata 的合法远端配置，不改变 Gateway 端口与认证等运行参数。 */
export function nacosRevisionConfig(revision) {
  return JSON.stringify({
    plugins: {
      entries: {
        nacos: { config: { metadata: { e2eRevision: revision } } },
      },
    },
  });
}

/** 通过 Nacos OpenAPI 发布配置，验证的仍是插件使用的真实 Config 长轮询链路。 */
export async function publishNacosConfig(content) {
  const body = new URLSearchParams({
    dataId: NACOS_E2E_DATA_ID,
    group: NACOS_E2E_GROUP,
    content,
    type: "json",
  });
  const response = await fetch(CONFIG_API, { method: "POST", body });
  const text = await response.text();
  if (!response.ok || text.trim() !== "true") {
    throw new Error(`Nacos publish failed: ${response.status} ${text}`);
  }
}

export async function bootstrapNacosConfig() {
  await publishNacosConfig(nacosRevisionConfig("bootstrap"));
}
