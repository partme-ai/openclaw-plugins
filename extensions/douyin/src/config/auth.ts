/**
 * 抖音开放平台 client_token 获取（client_credentials）
 * 文档：https://partner.open-douyin.com/docs/resource/zh-CN/dop/develop/openapi/account-permission/client-token
 */

import type { DouyinAccountConfig } from "../types.js";

const CLIENT_TOKEN_URL = "https://open.douyin.com/oauth/client_token/";

interface ClientTokenResponse {
  data?: {
    access_token?: string;
    expires_in?: number;
    error_code?: number;
  };
}

/**
 * 使用 app_key（client_key）、app_secret（client_secret）获取 client_token（access_token）
 */
export async function getClientToken(config: DouyinAccountConfig | undefined): Promise<string | null> {
  if (!config?.app_key || !config?.app_secret) return null;
  try {
    const res = await fetch(CLIENT_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credential",
        client_key: config.app_key,
        client_secret: config.app_secret,
      }),
    });
    const json = (await res.json()) as ClientTokenResponse;
    const token = json.data?.access_token;
    return token ?? null;
  } catch {
    return null;
  }
}
