/**
 * @fileoverview Bridge 第三方投递错误的日志脱敏。
 *
 * 来源 Channel 的 `message_sent.error` 与目标 MQ adapter 异常都由外部实现产生，可能携带
 * Authorization、Broker URL 用户信息或 Token。Bridge 只需要保留可定位的失败原因，不应把
 * 凭据复制到 Gateway 日志。
 */

const REDACTED = "[REDACTED]";

/** 把未知错误转换为最多 500 字符的单行安全诊断。 */
export function redactBridgeError(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value);
  const sanitized = raw
    .replace(/([a-z][a-z\d+.-]*:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/gi, `$1${REDACTED}@`)
    .replace(/\b(authorization|proxy-authorization|x-gotify-key)\s*[:=]\s*(?:bearer\s+|basic\s+)?[^\s,;]+/gi, `$1=${REDACTED}`)
    .replace(/\bbearer\s+[a-z\d._~+\/-]+=*/gi, `Bearer ${REDACTED}`)
    .replace(/([?&](?:access_token|refresh_token|token|api[_-]?key|client_secret|password)=)[^&#\s]*/gi, `$1${REDACTED}`)
    .replace(/\b(access[_-]?token|refresh[_-]?token|app[_-]?token|client[_-]?token|api[_-]?key|access[_-]?key|access[_-]?secret|client[_-]?secret|password|secret)\b\s*[:=]\s*["']?[^\s,;"'}]+["']?/gi, `$1=${REDACTED}`)
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim();
  return sanitized.slice(0, 500) || "unknown error";
}
