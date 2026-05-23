/**
 * ddd4j-rednote 底座 API 客户端（多租户模式）
 * 通过 API Key 调用底座，底座内部按 appId 注入 access_token 代调小红书 Open API。
 * 契约见：partme-docs/6、OctoClaw/15、ddd4j-rednote-底座-API契约与实现清单.md
 */

export interface RednoteClientConfig {
  /** 底座服务根地址，如 https://xxx/ddd4j-rednote */
  baseUrl: string;
  /** 平台颁发的 API Key（与 appId 绑定），调用底座时携带 */
  apiKey: string;
  /** 可选：租户/店铺标识，若底座从 API Key 解析则可不传 */
  appId?: string;
}

/**
 * 调用底座代理执行小红书 API
 * @param config 底座地址与 API Key
 * @param method 请求方法
 * @param path 小红书 API 路径，如 /api/order/list
 * @param params 请求参数（GET 为 query，POST 为 body 字段）
 * @returns 小红书 API 原始 JSON 或 { error: string }
 */
export async function rednoteExecute(
  config: RednoteClientConfig,
  method: "GET" | "POST",
  path: string,
  params: Record<string, string | number | undefined>
): Promise<unknown> {
  const base = config.baseUrl.replace(/\/$/, "");
  const url = `${base}/api/xhs/execute`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.apiKey}`,
  };
  const body = {
    method,
    path,
    params: normalizeParams(params),
  };

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    return { error: text || res.statusText };
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { data: text };
  }
}

function normalizeParams(
  params: Record<string, string | number | undefined>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) out[k] = String(v);
  }
  return out;
}
