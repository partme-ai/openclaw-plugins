/**
 * 敏感信息脱敏：优先使用 OpenClaw SDK，测试/离线环境使用最小 fallback。
 */
export function redactSensitiveText(value: string): string {
  let redacted = value;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("openclaw/plugin-sdk/security-runtime") as {
      redactSensitiveText?: (text: string) => string;
    };
    if (typeof mod.redactSensitiveText === "function") {
      redacted = mod.redactSensitiveText(value);
    }
  } catch {
    // optional peer — continue with the mandatory local fallback below
  }
  // SDK 与插件规则取并集：SDK 存在不代表它覆盖任意 Bearer/sk-* 形态。
  return redacted
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "sk-[REDACTED]");
}
