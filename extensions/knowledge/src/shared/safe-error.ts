/**
 * @fileoverview Knowledge 错误信息安全边界。
 *
 * Provider、Parser、SQLite 与本地文件系统的原始异常可能包含 URL 用户信息、API Key、
 * Authorization Header、本机绝对路径或控制字符。本模块只保留排障所需的短摘要，供
 * Hook 日志和 Tool 失败响应复用，避免每个调用点各写一套不完整的正则。
 */

const MAX_ERROR_LENGTH = 500;

/** 将未知异常转为经过凭据、路径和日志注入防护的单行摘要。 */
export function safeKnowledgeError(error: unknown, fallback = 'operation failed'): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : fallback;
  const withoutSecrets = raw
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/(bearer\s+)[^\s,;"']+/gi, '$1[REDACTED]')
    .replace(/((?:authorization|api[_-]?key|client[_-]?secret|access[_-]?token|password|passcode)\s*[=:]\s*)[^\s,;"']+/gi, '$1[REDACTED]')
    .replace(/("(?:authorization|api[_-]?key|client[_-]?secret|access[_-]?token|password|passcode)"\s*:\s*")[^"]*(")/gi, '$1[REDACTED]$2');

  // 绝对路径属于宿主部署细节。保留文件名或 sourceId 应由调用方显式记录，异常摘要本身
  // 不应把 /Users、/home、/var 等目录暴露给模型或远端调用者。
  return withoutSecrets
    .replace(/(^|[\s("'=])\/(?!\/)[^\s,;)"]+/gu, '$1[PATH]')
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/gu, ' ')
    .trim()
    .slice(0, MAX_ERROR_LENGTH) || fallback;
}
