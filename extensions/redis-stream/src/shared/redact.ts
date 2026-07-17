/**
 * Redis 错误信息的统一脱敏边界。
 *
 * node-redis 的连接错误可能回显完整 URL；错误进入日志、状态接口或结构化异常前，必须遮蔽
 * URL userinfo、当前配置凭据，移除控制字符并限制长度，避免 Redis ACL 密码泄漏。
 */
import type { RedisChannelConfig } from "../types.js";

export function redactRedisError(value: unknown, config?: RedisChannelConfig | null): string {
  let redacted = value instanceof Error ? value.message : String(value);
  const configuredUrl = config?.url;
  if (configuredUrl) {
    try {
      const parsed = new URL(configuredUrl);
      const secrets = [parsed.username, parsed.password]
        .filter(Boolean)
        .flatMap((secret) => [secret, decodeURIComponent(secret)]);
      for (const secret of secrets) redacted = redacted.split(secret).join("[REDACTED]");
    } catch {
      redacted = redacted.split(configuredUrl).join("<invalid-redis-url>");
    }
  }
  return redacted
    .replace(/(rediss?:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/giu, "$1[REDACTED]@")
    .replace(/[\u0000-\u001f\u007f]+/gu, " ")
    .slice(0, 500);
}
