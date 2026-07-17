/**
 * @fileoverview 外部 iPad 桥接服务异常的统一脱敏边界。
 *
 * WebSocket、HTTP 代理和外部服务都属于不可信边界，异常可能回显 Bearer Token、
 * Authorization Header、URL 用户信息或查询参数。本函数保证进入日志、Channel 错误和
 * Agent 会话的文本是单行、有限长度，并且不包含已配置的桥接凭据。
 */

/** 把外部异常归一化为适合日志和上层错误信封的安全摘要。 */
export function safeWechatIpadError(
  value: unknown,
  secrets: Array<string | undefined>,
  maximumLength = 1000,
  fallback = "wechat-ipad bridge error",
): string {
  const hasExternalText = value instanceof Error || typeof value === "string";
  let text = value instanceof Error ? value.message : typeof value === "string" ? value : fallback;
  text = text
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/giu, "$1[REDACTED]@")
    .replace(/(bearer\s+)[^\s,;"']+/giu, "$1[REDACTED]")
    .replace(/((?:authorization|api[_-]?key|access[_-]?token|password|secret|token)\s*[=:]\s*)[^\s&,;"']+/giu, "$1[REDACTED]");
  for (const secret of hasExternalText ? secrets : []) {
    if (secret) text = text.split(secret).join("[REDACTED]");
  }
  const normalized = text
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!normalized) return fallback;
  return normalized.length > maximumLength
    ? `${normalized.slice(0, Math.max(0, maximumLength - 1))}…`
    : normalized;
}
