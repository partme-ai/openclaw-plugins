/**
 * @fileoverview 美团平台与网络异常的统一安全出口。
 *
 * MTOp 错误最终会进入 Agent transcript。平台或代理可能回显 DeveloperId、Token、SignKey、
 * Authorization、签名表单或带用户信息的 URL，因此客户端和 Tool 必须共享同一套脱敏规则，
 * 不能依赖某一层已经“通常不会”泄露凭据。
 */

/** 将不可信异常压平为单行、有限长度且不包含已知凭据的诊断摘要。 */
export function safeMeituanError(
  value: unknown,
  secrets: Array<string | undefined>,
  maximumLength = 300,
  fallback = "unknown error",
): string {
  let text = value instanceof Error ? value.message : typeof value === "string" ? value : fallback;
  text = text
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/giu, "$1[REDACTED]@")
    .replace(/(bearer\s+)[^\s,;"']+/giu, "$1[REDACTED]")
    .replace(/((?:authorization|sign[_-]?key|app[_-]?auth[_-]?token|access[_-]?token|password|sign)\s*[=:]\s*)[^\s&,;"']+/giu, "$1[REDACTED]");
  for (const secret of secrets) {
    if (secret) text = text.split(secret).join("[REDACTED]");
  }
  return text
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maximumLength) || fallback;
}
