/**
 * @fileoverview Gotify 日志、健康状态和诊断报告的敏感信息脱敏。
 *
 * Gotify Client/App Token 会出现在查询参数、请求头和部分代理错误中。第三方错误在进入
 * OpenClaw 状态面之前统一经过这里，避免 token 轮换前被日志或诊断接口长期保留。
 */
import type { ResolvedGotifyAccount } from "../types.js";

/** 屏蔽已配置 token、URL 查询 token 与常见认证键值，并限制单条诊断长度。 */
export function redactGotifyError(
  value: unknown,
  account?: Pick<ResolvedGotifyAccount, "appToken" | "clientToken">,
): string {
  let text = value instanceof Error ? value.message : String(value);
  for (const secret of [account?.appToken, account?.clientToken]) {
    if (secret) text = text.split(secret).join("***");
  }
  text = text
    .replace(/([?&]token=)[^&#\s]+/gi, "$1***")
    .replace(
      /\b(X-Gotify-Key|appToken|clientToken|token)\b\s*[:=]\s*["']?[^\s,"'};]+/gi,
      "$1=***",
    )
    .replace(/[\r\n\t\u0000-\u001f\u007f]/g, " ")
    .trim();
  return text.slice(0, 500);
}
