/**
 * 美团 Open API 调用：鉴权与签名，与《美团开放平台对接规格》§5、接口对照表 API 文档一致。
 * 实际 base URL、path、签名算法以美团开放平台官方文档为准。
 */

import crypto from "node:crypto";
import type { MeituanAccountConfig } from "../types.js";

const MEITUAN_API_BASE = process.env.MEITUAN_API_BASE ?? "https://api.meituan.com";

/**
 * 对请求参数按 key 排序后拼接为 key1=value1&key2=value2，再使用 app_secret 做 HMAC-SHA256 签名（常见约定）。
 * 具体算法以美团开放平台接口文档为准。
 */
function signParams(params: Record<string, string>, appSecret: string): string {
  const sorted = Object.keys(params).sort();
  const str = sorted.map((k) => `${k}=${encodeURIComponent(params[k] ?? "")}`).join("&");
  return crypto.createHmac("sha256", appSecret).update(str, "utf8").digest("hex");
}

/**
 * 调用美团 Open API：GET/POST，带 app_key 与 sign。
 * 返回 JSON 解析结果；失败抛出或返回 { error }。
 */
export async function meituanApiCall(
  config: MeituanAccountConfig | undefined,
  path: string,
  method: "GET" | "POST",
  params: Record<string, string | number | undefined>
): Promise<unknown> {
  if (!config?.app_key || !config?.app_secret) {
    return { error: "meituan channel not configured" };
  }
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) flat[k] = String(v);
  }
  flat.app_key = config.app_key;
  flat.timestamp = String(Math.floor(Date.now() / 1000));
  flat.sign = signParams(flat, config.app_secret);

  const url = `${MEITUAN_API_BASE}${path}?${new URLSearchParams(flat).toString()}`;
  const res = await fetch(method === "POST" ? MEITUAN_API_BASE + path : url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: method === "POST" ? JSON.stringify(flat) : undefined,
  });
  const text = await res.text();
  if (!res.ok) return { error: text || res.statusText };
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { data: text };
  }
}
