/**
 * 敏感信息脱敏：优先使用 OpenClaw SDK，测试/离线环境使用最小 fallback。
 */
export function redactSensitiveText(value: string): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("openclaw/plugin-sdk/security-runtime") as {
      redactSensitiveText?: (text: string) => string;
    };
    if (typeof mod.redactSensitiveText === "function") {
      return mod.redactSensitiveText(value);
    }
  } catch {
    // optional peer — use fallback below
  }
  return value
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "sk-[REDACTED]");
}
