/**
 * 日志边界的最小脱敏工具。
 *
 * 第三方 HTTP SDK 抛出的异常可能包含完整 URL、查询参数、换行符或超长响应片段。
 * 这些内容不能原样进入 Gateway 日志：查询参数可能携带 access_token，控制字符还会
 * 破坏一行一事件的日志结构。这里仅保留便于定位的短摘要，不承担业务错误分类职责。
 */

const MAX_ERROR_SUMMARY_LENGTH = 512;

function redactUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.username = "";
    url.password = "";
    url.search = url.search ? "?REDACTED" : "";
    url.hash = "";
    return url.toString();
  } catch {
    return "[REDACTED_URL]";
  }
}

/** 将未知异常转换为单行、定长且不包含 URL 凭据/查询参数的日志摘要。 */
export function toSafeErrorSummary(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const redacted = raw
    .replace(/https?:\/\/[^\s"'<>]+/giu, redactUrl)
    .replace(/\b(access_token|token|secret|authorization|password)=([^\s&,;]+)/giu, "$1=REDACTED")
    .replace(/[\u0000-\u001f\u007f]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!redacted) return "unknown error";
  return redacted.length <= MAX_ERROR_SUMMARY_LENGTH
    ? redacted
    : `${redacted.slice(0, MAX_ERROR_SUMMARY_LENGTH - 1)}…`;
}
