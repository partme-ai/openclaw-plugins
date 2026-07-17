/**
 * @fileoverview Router 诊断错误脱敏。
 *
 * 目标渠道 adapter 的错误可能包含 Authorization、URL 用户信息或查询参数中的凭据。
 * Router 会把错误写入日志、状态、审计和持久 DLQ，因此必须在进入这些边界前统一清洗，
 * 避免一次第三方连接失败把长期有效的密钥写进磁盘或运维接口。
 */

const MAX_DIAGNOSTIC_LENGTH = 500;
const REDACTED = "[REDACTED]";

/** 将未知异常转换为适合日志与持久诊断的单行脱敏文本。 */
export function redactRouterError(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value);
  const sanitized = raw
    // URL userinfo：例如 https://user:password@broker.example.com。
    .replace(/([a-z][a-z\d+.-]*:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/gi, `$1${REDACTED}@`)
    // Authorization/Bearer 与常见 HTTP 认证头。
    .replace(/\b(authorization|proxy-authorization|x-gotify-key)\s*[:=]\s*(?:bearer\s+|basic\s+)?[^\s,;]+/gi, `$1=${REDACTED}`)
    .replace(/\bbearer\s+[a-z\d._~+\/-]+=*/gi, `Bearer ${REDACTED}`)
    // URL 查询参数中的密钥；保留参数名以便定位配置项。
    .replace(/([?&](?:access_token|refresh_token|token|api[_-]?key|client_secret|password)=)[^&#\s]*/gi, `$1${REDACTED}`)
    // JSON、日志键值和 SDK 错误中常见的凭据字段。
    .replace(/\b(access[_-]?token|refresh[_-]?token|app[_-]?token|client[_-]?token|api[_-]?key|access[_-]?key|access[_-]?secret|client[_-]?secret|password|secret)\b\s*[:=]\s*["']?[^\s,;"'}]+["']?/gi, `$1=${REDACTED}`)
    // 控制字符会伪造多行日志或破坏 JSON 运维输出。
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim();
  return sanitized.slice(0, MAX_DIAGNOSTIC_LENGTH) || "unknown error";
}
