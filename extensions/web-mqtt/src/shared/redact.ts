/**
 * Web-MQTT 错误公开边界：遮蔽认证凭据、Bearer/sk token 与控制字符。
 * 第三方 WebSocket/Aedes 错误只允许以单行、有限长度摘要进入 `/mqtt-ws/status`。
 */
import type { WebMqttConfig } from "../types.js";
import { redactSensitiveText as redactOpenClawSensitiveText } from "openclaw/plugin-sdk/security-runtime";

export function redactWebMqttError(value: unknown, config?: WebMqttConfig | null): string {
  // 插件以 ESM 发布；静态导入 peer runtime 才能保证真实 Gateway 一定执行官方脱敏规则。
  let redacted = redactOpenClawSensitiveText(
    value instanceof Error ? value.message : String(value),
    { mode: "tools" },
  );
  const secrets = (config?.auth.users ?? [])
    .flatMap((user) => [user.password, user.passwordHash])
    .filter((secret): secret is string => Boolean(secret));
  for (const secret of secrets) redacted = redacted.split(secret).join("[REDACTED]");
  return redacted
    .replace(/\b(Bearer|Basic|Bot)\s+[^\s,;]+/giu, "$1 [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gu, "sk-[REDACTED]")
    .replace(
      /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd|secret)\b\s*([:=])\s*([^\s,;&]+)/giu,
      "$1$2[REDACTED]",
    )
    .replace(/[\u0000-\u001f\u007f]+/gu, " ")
    .slice(0, 500);
}
