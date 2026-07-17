/**
 * @fileoverview OpenMem 外部错误进入日志和 Memory Host 状态前的统一脱敏边界。
 *
 * Sidecar/反向代理错误正文不可信，除当前 apiKey 外仍可能包含 Bearer、sk-* 或控制字符；
 * 因此所有公开错误都先经过 SDK 与本地规则联合清洗，并限制为 500 字符。
 */
export function redactOpenMemError(value: unknown, explicitSecret?: string): string {
  let redacted = value instanceof Error ? value.message : String(value);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("openclaw/plugin-sdk/security-runtime") as {
      redactSensitiveText?: (text: string) => string;
    };
    if (typeof mod.redactSensitiveText === "function") redacted = mod.redactSensitiveText(redacted);
  } catch {
    // isolated unit tests can run without the optional OpenClaw security module
  }
  if (explicitSecret) redacted = redacted.split(explicitSecret).join("[REDACTED]");
  return redacted
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "sk-[REDACTED]")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .slice(0, 500);
}
