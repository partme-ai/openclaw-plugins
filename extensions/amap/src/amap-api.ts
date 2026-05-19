/**
 * 高德 Web 服务 API 调用：key 鉴权，与《高德开放平台对接规格》§5 一致。
 * Base URL 以高德开放平台文档为准。
 */

import type { AmapAccountConfig } from "./types.js";

const AMAP_API_BASE = process.env.AMAP_API_BASE ?? "https://restapi.amap.com";

/**
 * 调用高德 Web 服务 API（GET，key 作为 query 参数）。
 * 返回 JSON 解析结果；失败返回 { error }。
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
