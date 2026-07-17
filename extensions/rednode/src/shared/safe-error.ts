/**
 * @fileoverview 小红书 Ark 平台与网络异常的统一安全出口。
 *
 * Ark 错误最终会进入 Agent transcript。平台、代理或底层网络库可能回显 app-key、
 * app-secret、sign、Authorization，甚至包含用户信息的 URL，因此客户端与 Tool 最终出口
 * 共用同一套脱敏规则，形成纵深防御，不能假设某一层永远只抛出“安全错误”。
 */

/** 将不可信异常压平为单行、有限长度且不包含已知凭据的诊断摘要。 */
export function safeRednodeError(
  value: unknown,
  secrets: Array<string | undefined>,
  maximumLength = 300,
  fallback = "unknown error",
): string {
  const hasExternalText = value instanceof Error || typeof value === "string";
  let text = value instanceof Error ? value.message : typeof value === "string" ? value : fallback;
  text = text
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/giu, "$1[REDACTED]@")
    .replace(/(bearer\s+)[^\s,;"']+/giu, "$1[REDACTED]")
    .replace(/((?:authorization|app[_-]?(?:key|secret)|access[_-]?token|password|sign)\s*[=:]\s*)[^\s&,;"']+/giu, "$1[REDACTED]");
  // 固定 fallback 由插件自身生成，不含外部数据；跳过替换可避免极短测试凭据误伤安全文案。
  for (const secret of hasExternalText ? secrets : []) {
    if (secret) text = text.split(secret).join("[REDACTED]");
  }
  return text
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maximumLength) || fallback;
}
