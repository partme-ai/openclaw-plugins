/**
 * 抖音 Webhook 协议工具函数。
 *
 * **架构角色**：入站 handler 的纯函数层，负责 URL 验证挑战、SHA1 验签与发送方解析，
 * 与 HTTP/派发逻辑解耦便于单测。
 *
 * **关键依赖**：`node:crypto`
 */

import { createHash } from "node:crypto";

/**
 * 解析开放平台 Webhook URL 验证事件（`verify_webhook`）。
 *
 * @param body 原始请求体（JSON 字符串）
 * @returns challenge 明文；非验证事件或解析失败时返回 null
 */
export function tryParseVerifyWebhookChallenge(body: string): string | null {
  try {
    const json = JSON.parse(body) as { event?: string; content?: { challenge?: number | string } };
    if (json.event !== "verify_webhook" || json.content == null) {
      return null;
    }
    const c = json.content.challenge;
    return c !== undefined && c !== null ? String(c) : null;
  } catch {
    return null;
  }
}

/**
 * 校验抖音 Webhook 签名：`SHA1(app_secret + rawBody)` 与请求头比对。
 *
 * @param secret 账号 app_secret
 * @param rawBody 未解析的原始请求体
 * @param signatureHeader `X-Douyin-Signature` 请求头值
 * @returns 签名一致时为 true；缺少 header 时为 false
 */
export function verifyDouyinSignature(
  secret: string,
  rawBody: string,
  signatureHeader: string | undefined,
): boolean {
  if (!signatureHeader) {
    return false;
  }
  const payload = secret + rawBody;
  const hash = createHash("sha1").update(payload, "utf8").digest("hex");
  return hash === signatureHeader.trim();
}

/**
 * 从回调 JSON 中解析发送方用户 id（多字段兼容）。
 *
 * @param rawBody Webhook 原始 JSON 字符串
 * @returns 发送方 open_id / user_id；未知结构或非 JSON 时返回 null
 */
export function extractDouyinSenderId(rawBody: string): string | null {
  try {
    const json = JSON.parse(rawBody) as Record<string, unknown>;
    const content = json.content as Record<string, unknown> | undefined;
    const fromContent =
      content?.from_user_id ?? content?.user_id ?? content?.user_open_id ?? content?.open_id;
    const top = json.from_user_id ?? json.user_open_id ?? json.open_id;
    const v = fromContent ?? top;
    if (v != null && v !== "") {
      return String(v);
    }
  } catch {
    // 非 JSON 时无法解析
  }
  return null;
}
