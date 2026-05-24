/**
 * 抖音开放平台 OAuth client_token 获取。
 *
 * **架构角色**：运营工具与 OpenAPI 调用的鉴权前置步骤（client_credentials 模式）。
 *
 * **文档**：https://partner.open-douyin.com/docs/resource/zh-CN/dop/develop/openapi/account-permission/client-token
 *
 * **关键依赖**：`../types`
 */

import type { DouyinAccountConfig } from "../types.js";

const CLIENT_TOKEN_URL = "https://open.douyin.com/oauth/client_token/";

/** 开放平台 client_token 接口响应体（节选） */
interface ClientTokenResponse {
  data?: {
    access_token?: string;
    expires_in?: number;
    error_code?: number;
  };
}

/**
 * 使用 app_key（client_key）、app_secret（client_secret）换取 client_token。
 *
 * @param config 渠道配置；缺少凭据时直接返回 null
 * @returns access_token 字符串；网络错误或接口失败时返回 null（不抛异常）
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
