/**
 * Web-MQTT 错误公开边界：遮蔽认证凭据、Bearer/sk token 与控制字符。
 * 第三方 WebSocket/Aedes 错误只允许以单行、有限长度摘要进入 `/mqtt-ws/status`。
 */
import type { WebMqttConfig } from "../types.js";

export function redactWebMqttError(value: unknown, config?: WebMqttConfig | null): string {
  let redacted = value instanceof Error ? value.message : String(value);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("openclaw/plugin-sdk/security-runtime") as {
      redactSensitiveText?: (text: string) => string;
    };
    if (typeof mod.redactSensitiveText === "function") redacted = mod.redactSensitiveText(redacted);
  } catch {
    // 独立单测不要求安装 OpenClaw，继续使用插件本地规则。
  }
  const secrets = (config?.auth.users ?? [])
    .flatMap((user) => [user.password, user.passwordHash])
    .filter((secret): secret is string => Boolean(secret));
  for (const secret of secrets) redacted = redacted.split(secret).join("[REDACTED]");
  return redacted
    .replace(/Bearer\s+\S+/giu, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gu, "sk-[REDACTED]")
    .replace(/[\u0000-\u001f\u007f]+/gu, " ")
    .slice(0, 500);
}
