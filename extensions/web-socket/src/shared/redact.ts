/**
 * WebSocket 传输错误的统一脱敏边界。
 *
 * 握手错误可能回显 URL userinfo、Bearer Header 或配置 Token；进入日志和 Gateway 状态前
 * 必须遮蔽凭据、移除控制字符并限制长度，避免第三方错误对象泄漏秘密或污染日志。
 */
import type { WebsocketChannelConfig } from "../types.js";
import { redactSensitiveText as redactOpenClawSensitiveText } from "openclaw/plugin-sdk/security-runtime";

export function redactWebSocketError(value: unknown, config?: WebsocketChannelConfig | null): string {
  // 插件以 ESM 发布；静态导入 peer runtime 才能保证正式 Gateway 执行官方脱敏规则。
  let redacted = redactOpenClawSensitiveText(
    value instanceof Error ? value.message : String(value),
    { mode: "tools" },
  );
  const secrets = [
    config?.server.auth.token,
    ...(config?.server.auth.tokens ?? []),
    config?.client.token,
    ...Object.values(config?.client.headers ?? {}),
  ].filter((secret): secret is string => Boolean(secret));
  for (const secret of secrets) redacted = redacted.split(secret).join("[REDACTED]");
  return redacted
    .replace(/(wss?:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/giu, "$1[REDACTED]@")
    .replace(/\b(Bearer|Basic|Bot)\s+[^\s,;]+/giu, "$1 [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gu, "sk-[REDACTED]")
    .replace(
      /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd|secret)\b\s*([:=])\s*([^\s,;&]+)/giu,
      "$1$2[REDACTED]",
    )
    .replace(/[\u0000-\u001f\u007f]+/gu, " ")
    .slice(0, 500);
}

/** 状态与日志只保留 WebSocket Origin + Path，移除 userinfo、query 与 fragment。 */
export function sanitizeWebSocketUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "ws:" && url.protocol !== "wss:") return null;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}
