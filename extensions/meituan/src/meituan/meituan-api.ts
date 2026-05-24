/**
 * 美团 Open API 调用层（鉴权与签名）。
 *
 * **架构角色**：tools 模块的 HTTP 客户端；负责参数扁平化、timestamp、HMAC 签名。
 *
 * **业务说明**：与《美团开放平台对接规格》§5 对齐；base URL 可通过 `MEITUAN_API_BASE` 覆盖。
 *
 * **关键依赖**：`node:crypto`、`../types`
 */

import crypto from "node:crypto";
import type { MeituanAccountConfig } from "../types.js";

/** OpenAPI 网关 base URL（默认 api.meituan.com） */
const MEITUAN_API_BASE = process.env.MEITUAN_API_BASE ?? "https://api.meituan.com";

/**
 * 对请求参数按 key 字典序拼接后 HMAC-SHA256 签名。
 *
 * @param params 待签名字段（不含 sign）
 * @param appSecret 应用 secret
 * @returns 十六进制签名字符串
 */
function signParams(params: Record<string, string>, appSecret: string): string {
  const sorted = Object.keys(params).sort();
  const str = sorted.map((k) => `${k}=${encodeURIComponent(params[k] ?? "")}`).join("&");
  return crypto.createHmac("sha256", appSecret).update(str, "utf8").digest("hex");
}

/**
 * 调用美团 Open API（GET/POST，自动附带 app_key、timestamp、sign）。
 *
 * @param config 渠道凭据；缺失时返回 `{ error: "meituan channel not configured" }`
 * @param path API 路径（如 `/open/order/list`）
 * @param method HTTP 方法
 * @param params 业务 query/body 参数
 * @returns 解析后的 JSON；HTTP 非 2xx 时返回 `{ error }`
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

  // GET：参数放 query；POST：同字段 JSON body（以官方文档为准）
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
