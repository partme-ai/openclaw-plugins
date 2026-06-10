/**
 * 高德 Web 服务 API 客户端（Infrastructure）
 *
 * **架构角色**：封装高德 REST API 的 GET 调用与 key 鉴权，
 * 供 Agent 工具层（`tools/tools.ts`）统一调用。
 *
 * 与《高德开放平台对接规格》§5 一致；Base URL 以官方文档为准。
 *
 * **关键依赖**：`../types` — `AmapAccountConfig`
 */

import type { AmapAccountConfig } from "../types.js";

/**
 * 高德 API Base URL。
 * 可通过环境变量 `AMAP_API_BASE` 覆盖（测试 / 代理场景）。
 */
const AMAP_API_BASE = process.env.AMAP_API_BASE ?? "https://restapi.amap.com";

/**
 * 调用高德 Web 服务 API（GET，key 作为 query 参数）。
 *
 * @param config - 账号配置，须含 `key`；未配置时返回 `{ error: "amap channel not configured" }`
 * @param path - API 路径，如 `/v3/place/text`
 * @param params - 业务 query 参数（`undefined` / `null` 值会被忽略）
 * @returns 成功时为 JSON 解析结果；HTTP 非 2xx 返回 `{ error }`；非 JSON 响应返回 `{ data: text }`
 */
export async function amapApiCall(
  config: AmapAccountConfig | undefined,
  path: string,
  params: Record<string, string | number | undefined>
): Promise<unknown> {
  if (!config?.key) {
    return { error: "amap channel not configured" };
  }
  const flat: Record<string, string> = { key: config.key };
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) flat[k] = String(v);
  }
  const url = `${AMAP_API_BASE}${path}?${new URLSearchParams(flat).toString()}`;
  const res = await fetch(url, { method: "GET" });
  const text = await res.text();
  if (!res.ok) return { error: text || res.statusText };
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { data: text };
  }
}
