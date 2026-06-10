/**
 * 小红书 Open API 调用：鉴权与签名，与《小红书开放平台对接规格》§5、xiaohongshu.apifox.cn 一致。
 * 支持直连（app_id+app_secret）与多租户底座模式（ddd4j_api_base+ddd4j_api_key）；底座模式不持密钥。
 */

import crypto from "node:crypto";
import type { XhsAccountConfig } from "../types.js";
import { rednoteExecute } from "./rednote-api-client.js";
import { xhsFetch, readResponseBodyAsBuffer } from "../shared/http.js";

const XHS_API_BASE = process.env.XHS_API_BASE ?? "https://open.xiaohongshu.com";

/**
 * 对请求参数按 key 排序后拼接为 key1=value1&key2=value2，再使用 app_secret 做 HMAC-SHA256 签名。
 * 具体算法以小红书开放平台接口文档（xiaohongshu.apifox.cn）为准。
 */
function signParams(params: Record<string, string>, appSecret: string): string {
  const sorted = Object.keys(params).sort();
  const str = sorted.map((k) => `${k}=${encodeURIComponent(params[k] ?? "")}`).join("&");
  return crypto.createHmac("sha256", appSecret).update(str, "utf8").digest("hex");
}

/**
 * 调用小红书 Open API：优先多租户底座模式（配置了 ddd4j_api_base + ddd4j_api_key 时走底座代理），否则直连。
 * 返回 JSON 解析结果；失败返回 { error }。
 */
export async function xhsApiCallOrProxy(
  config: XhsAccountConfig | undefined,
  path: string,
  method: "GET" | "POST",
  params: Record<string, string | number | undefined>
): Promise<unknown> {
  if (!config?.app_id) {
    return { error: "xhs channel not configured" };
  }
  if (config.ddd4j_api_base && config.ddd4j_api_key) {
    return rednoteExecute(
      {
        baseUrl: config.ddd4j_api_base,
        apiKey: config.ddd4j_api_key,
        appId: config.app_id,
      },
      method,
      path,
      params
    );
  }
  return xhsApiCall(config, path, method, params);
}

/**
 * 直连小红书 Open API：GET/POST，带 app_id 与 sign（仅当未配置底座时使用）。
 */
export async function xhsApiCall(
  config: XhsAccountConfig | undefined,
  path: string,
  method: "GET" | "POST",
  params: Record<string, string | number | undefined>
): Promise<unknown> {
  if (!config?.app_id || !config?.app_secret) {
    return { error: "xhs channel not configured" };
  }
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) flat[k] = String(v);
  }
  flat.app_id = config.app_id;
  flat.timestamp = String(Math.floor(Date.now() / 1000));
  flat.sign = signParams(flat, config.app_secret);

  const url = `${XHS_API_BASE}${path}?${new URLSearchParams(flat).toString()}`;
  const res = await xhsFetch(undefined, method === "POST" ? XHS_API_BASE + path : url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: method === "POST" ? JSON.stringify(flat) : undefined,
  });
  const text = (await readResponseBodyAsBuffer(res)).toString("utf8");
  if (!res.ok) return { error: text || res.statusText };
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { data: text };
  }
}
