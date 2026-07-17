/**
 * @fileoverview OpenMem 外部错误进入日志和 Memory Host 状态前的统一脱敏边界。
 *
 * Sidecar/反向代理错误正文不可信，除当前 apiKey 外仍可能包含 Bearer、sk-* 或控制字符；
 * 因此所有公开错误都先经过 SDK 与本地规则联合清洗，并限制为 500 字符。
 */
import { redactSensitiveText as redactOpenClawSensitiveText } from "openclaw/plugin-sdk/security-runtime";

export function redactOpenMemError(value: unknown, explicitSecret?: string): string {
  // OpenMem 以 ESM 发布，静态导入才能保证正式 Gateway 真实执行 OpenClaw 官方脱敏器。
  let redacted = redactOpenClawSensitiveText(
    value instanceof Error ? value.message : String(value),
    { mode: "tools" },
  );
  if (explicitSecret) redacted = redacted.split(explicitSecret).join("[REDACTED]");
  return redacted
    .replace(/\b(Bearer|Basic|Bot)\s+[^\s,;]+/giu, "$1 [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "sk-[REDACTED]")
    .replace(
      /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd|secret)\b\s*([:=])\s*([^\s,;&]+)/giu,
      "$1$2[REDACTED]",
    )
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .slice(0, 500);
}
