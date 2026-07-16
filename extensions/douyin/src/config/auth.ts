/**
 * 抖音开放平台 OAuth client_token 获取。
 *
 * **架构角色**：运营工具与 OpenAPI 调用的鉴权前置步骤（client_credentials 模式）。
 *
 * **文档**：https://partner.open-douyin.com/docs/resource/zh-CN/dop/develop/openapi/account-permission/client-token
 *
 * **关键依赖**：`../types`
 */

import { createHash } from "node:crypto";

import type { ChannelLimitsOpenClawConfig } from "../runtime/runtime-api.js";
import type { DouyinAccountConfig } from "../types.js";
import { douyinFetch, readResponseBodyAsBuffer } from "../shared/http.js";

const CLIENT_TOKEN_URL = "https://open.douyin.com/oauth/client_token/";
const MAX_JSON_RESPONSE_BYTES = 2 * 1024 * 1024;

/** 开放平台 client_token 接口响应体（节选） */
interface ClientTokenResponse {
  data?: {
    access_token?: string;
    expires_in?: number;
    error_code?: number;
    description?: string;
  };
  message?: string;
}

type TokenCacheEntry = { token: string; expiresAt: number };
const tokenCache = new Map<string, TokenCacheEntry>();
const tokenRequests = new Map<string, Promise<string>>();

function cacheKey(config: DouyinAccountConfig): string {
  return createHash("sha256")
    .update(`${config.app_key}\0${config.app_secret}`)
    .digest("hex");
}

/**
 * 使用 app_key（client_key）、app_secret（client_secret）换取 client_token。
 *
 * @param config 渠道配置；缺少凭据时直接返回 null
 * @returns access_token 字符串；网络错误或接口失败时返回 null（不抛异常）
 */
export async function getClientToken(
  config: DouyinAccountConfig | undefined,
  rootConfig?: ChannelLimitsOpenClawConfig,
): Promise<string | null> {
  if (!config?.app_key || !config?.app_secret) return null;
  const key = cacheKey(config);
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const pending = tokenRequests.get(key);
  if (pending) return pending;

  const request = (async (): Promise<string> => {
    const res = await douyinFetch(rootConfig, CLIENT_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credential",
        client_key: config.app_key,
        client_secret: config.app_secret,
      }),
    }, { timeoutMs: config.request_timeout_ms ?? 10_000 });
    let json: ClientTokenResponse;
    try {
      json = JSON.parse(
        (await readResponseBodyAsBuffer(res, MAX_JSON_RESPONSE_BYTES)).toString("utf8"),
      ) as ClientTokenResponse;
    } catch (error) {
      throw new Error(
        `[douyin] client_token returned invalid or oversized JSON (HTTP ${res.status})`,
        { cause: error },
      );
    }
    const token = json.data?.access_token;
    if (!res.ok || !token || json.data?.error_code !== 0) {
      throw new Error(
        `[douyin] client_token failed (${res.status}/${json.data?.error_code ?? "unknown"}): ${json.data?.description ?? json.message ?? "unknown error"}`,
      );
    }
    tokenCache.set(key, {
      token,
      expiresAt: Date.now() + Math.max(60, json.data?.expires_in ?? 7200) * 1000,
    });
    return token;
  })();
  tokenRequests.set(key, request);
  try {
    return await request;
  } finally {
    tokenRequests.delete(key);
  }
}

/** 仅供测试和配置热更新时主动清理本地 token 缓存。 */
export function clearClientTokenCache(): void {
  tokenCache.clear();
  tokenRequests.clear();
}

export function invalidateClientToken(config: DouyinAccountConfig): void {
  if (!config.app_key || !config.app_secret) return;
  const key = cacheKey(config);
  tokenCache.delete(key);
  tokenRequests.delete(key);
}
