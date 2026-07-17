/**
 * Redis 错误信息的统一脱敏边界。
 *
 * node-redis 的连接错误可能回显完整 URL；错误进入日志、状态接口或结构化异常前，必须遮蔽
 * URL userinfo、当前配置凭据，移除控制字符并限制长度，避免 Redis ACL 密码泄漏。
 */
import type { RedisChannelConfig } from "../types.js";
import { redactSensitiveText as redactOpenClawSensitiveText } from "openclaw/plugin-sdk/security-runtime";

export function redactRedisError(
  value: unknown,
  config?: RedisChannelConfig | null,
): string {
  // 静态 ESM 导入保证生产 Gateway 一定执行 OpenClaw 2026.7.1 官方安全规则。
  let redacted = redactOpenClawSensitiveText(
    value instanceof Error ? value.message : String(value),
    { mode: "tools" },
  );
  const configuredUrl = config?.url;
  if (configuredUrl) {
    try {
      const parsed = new URL(configuredUrl);
      const secrets = [parsed.username, parsed.password]
        .filter(Boolean)
        .flatMap((secret) => [secret, decodeURIComponent(secret)]);
      for (const secret of secrets)
        redacted = redacted.split(secret).join("[REDACTED]");
    } catch {
      redacted = redacted.split(configuredUrl).join("<invalid-redis-url>");
    }
  }
  return redacted
    .replace(/(rediss?:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/giu, "$1[REDACTED]@")
    .replace(/\b(Bearer|Basic|Bot)\s+[^\s,;]+/giu, "$1 [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gu, "sk-[REDACTED]")
    .replace(/[\u0000-\u001f\u007f]+/gu, " ")
    .slice(0, 500);
}
