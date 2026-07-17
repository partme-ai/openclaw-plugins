/**
 * @module wechat/util/redact
 *
 * 敏感信息脱敏工具。
 */

const DEFAULT_BODY_MAX_LEN = 200;
const DEFAULT_TOKEN_PREFIX_LEN = 6;

/**
 * Truncate a string, appending a length indicator when trimmed.
 * Returns `""` for empty/undefined input.
 */
export function truncate(s: string | undefined, max: number): string {
  if (!s) return "";
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…(len=${s.length})`;
}

/**
 * Redact a token/secret: show only the first few chars + total length.
 * Returns `"(none)"` when absent.
 */
export function redactToken(token: string | undefined, prefixLen = DEFAULT_TOKEN_PREFIX_LEN): string {
  if (!token) return "(none)";
  if (token.length <= prefixLen) return `****(len=${token.length})`;
  return `${token.slice(0, prefixLen)}…(len=${token.length})`;
}

/** Field names whose values should be masked in logged JSON bodies. */
const SENSITIVE_FIELDS = /\b(context_token|bot_token|token|authorization|Authorization)\b/;

/**
 * Truncate a JSON body string to `maxLen` chars for safe logging.
 * Redacts known sensitive fields before truncating.
 */
export function redactBody(body: string | undefined, maxLen = DEFAULT_BODY_MAX_LEN): string {
  if (!body) return "(empty)";
  // Mask values of known sensitive JSON keys: "key":"value" → "key":"<redacted>"
  const redacted = body.replace(
    /"(context_token|bot_token|token|authorization|Authorization)"\s*:\s*"[^"]*"/g,
    '"$1":"<redacted>"',
  );
  if (redacted.length <= maxLen) return redacted;
  return `${redacted.slice(0, maxLen)}…(truncated, totalLen=${redacted.length})`;
}

/**
 * Strip query string (which often contains signatures/tokens) from a URL,
 * keeping only origin + pathname.
 */
export function redactUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const base = `${u.origin}${u.pathname}`;
    return u.search ? `${base}?<redacted>` : base;
  } catch {
    return truncate(rawUrl, 80);
  }
}

/**
 * 日志最终出口的兜底脱敏。
 *
 * 业务代码仍应优先只记录状态、长度和错误类别；这里防止第三方错误文本或后续维护
 * 又把 userId、session、文件路径、URL 参数等拼回日志。它会主动牺牲可逆性，
 * 因此只用于运行日志，不用于需要保存原文的审计记录。
 */
export function sanitizeLogMessage(message: string, maxLen = 1_000): string {
  const withoutControls = message.replace(/[\r\n\t\0]/g, " ");
  const redactedQuoted = withoutControls.replace(
    /\b(body|text|args|preview)=("[^"]*"|'[^']*')/gi,
    "$1=<redacted>",
  );
  const redactedFields = redactedQuoted.replace(
    /\b(from|to|userId|accountId|account|sessionId|sessionKey|mainSessionKey|clientId|contextToken|token|qrcode|filePath|path)=([^\s,]+)/gi,
    "$1=<redacted>",
  );
  const redactedUrls = redactedFields.replace(/https?:\/\/[^\s]+/gi, (raw) => {
    try {
      return `<url:${new URL(raw).hostname}>`;
    } catch {
      return "<url:redacted>";
    }
  });
  return truncate(redactedUrls, maxLen);
}
