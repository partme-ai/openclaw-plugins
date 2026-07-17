/**
 * @module mqtt/shared/redact
 *
 * MQTT、Redis、MongoDB 等外部组件的错误进入日志或状态接口前统一脱敏。
 * 除 OpenClaw 通用规则外，还遮蔽本插件配置中的用户口令、哈希凭据、Redis 密码与
 * MongoDB URI userinfo，避免连接失败时第三方库把凭据原样拼进错误信息。
 */

import type { MqttBrokerConfig } from "../types.js";

/** 将不可信错误压缩为单行、有限长度且不包含已配置凭据的诊断摘要。 */
export function redactMqttError(value: unknown, config?: MqttBrokerConfig | null): string {
  let redacted = value instanceof Error ? value.message : String(value);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("openclaw/plugin-sdk/security-runtime") as {
      redactSensitiveText?: (text: string) => string;
    };
    if (typeof mod.redactSensitiveText === "function") redacted = mod.redactSensitiveText(redacted);
  } catch {
    // 独立单测和打包检查不一定安装 OpenClaw；本地规则仍会继续执行。
  }

  const secrets = [
    config?.persistence?.redis?.password,
    ...((config?.auth?.users ?? []).flatMap((user) => [user.password, user.passwordHash])),
  ].filter((secret): secret is string => Boolean(secret));
  for (const secret of secrets) redacted = redacted.split(secret).join("[REDACTED]");

  return redacted
    .replace(/(mongodb(?:\+srv)?:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/giu, "$1[REDACTED]@")
    .replace(/Bearer\s+\S+/giu, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gu, "sk-[REDACTED]")
    .replace(/[\u0000-\u001f\u007f]+/gu, " ")
    .slice(0, 500);
}
