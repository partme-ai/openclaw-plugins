/**
 * 抖音 Webhook 共用：verify_webhook 挑战、SHA1 验签、发送方 ID 解析。
 */

import { createHash } from "node:crypto";

/** 若为 verify_webhook 事件则返回 challenge 字符串，否则返回 null */
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

/** 使用 app_secret + rawBody 计算 SHA1，与 X-Douyin-Signature 比对 */
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
 * 从回调 JSON 中尽量解析发送方 ID；未知结构时返回 null（由上层生成占位 peer）。
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
