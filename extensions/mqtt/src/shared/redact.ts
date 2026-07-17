/**
 * @module mqtt/shared/redact
 *
 * MQTT、Redis、MongoDB 等外部组件的错误进入日志或状态接口前统一脱敏。
 * 除 OpenClaw 通用规则外，还遮蔽本插件配置中的用户口令、哈希凭据、Redis 密码与
 * MongoDB URI userinfo，避免连接失败时第三方库把凭据原样拼进错误信息。
 */

import type { MqttBrokerConfig } from "../types.js";
import { redactSensitiveText as redactOpenClawSensitiveText } from "openclaw/plugin-sdk/security-runtime";

/** 将不可信错误压缩为单行、有限长度且不包含已配置凭据的诊断摘要。 */
export function redactMqttError(value: unknown, config?: MqttBrokerConfig | null): string {
  // MQTT 以 ESM 发布，静态导入 peer runtime 才能保证真实 Gateway 会执行官方脱敏器。
  let redacted = redactOpenClawSensitiveText(
    value instanceof Error ? value.message : String(value),
    { mode: "tools" },
  );

  const secrets = [
    config?.persistence?.redis?.password,
    ...((config?.auth?.users ?? []).flatMap((user) => [user.password, user.passwordHash])),
  ].filter((secret): secret is string => Boolean(secret));
  for (const secret of secrets) redacted = redacted.split(secret).join("[REDACTED]");

  return redacted
    .replace(/(mongodb(?:\+srv)?:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/giu, "$1[REDACTED]@")
    .replace(/\b(Bearer|Basic|Bot)\s+[^\s,;]+/giu, "$1 [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gu, "sk-[REDACTED]")
    .replace(
      /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd|secret)\b\s*([:=])\s*([^\s,;&]+)/giu,
      "$1$2[REDACTED]",
    )
    .replace(/[\u0000-\u001f\u007f]+/gu, " ")
    .slice(0, 500);
}
