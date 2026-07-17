/**
 * RabbitMQ 错误信息的统一脱敏边界。
 *
 * amqplib 的连接、握手和 Channel 错误可能回显完整 AMQP URL。错误进入日志、健康接口或
 * NACK 诊断前，必须遮蔽 URL userinfo、当前配置凭据并移除控制字符，避免状态面泄漏秘密。
 */
import type { RabbitmqConfig } from "../config.js";

export function redactRabbitmqError(value: unknown, config?: RabbitmqConfig | null): string {
  let redacted = value instanceof Error ? value.message : String(value);
  const configuredUrl = config?.url;
  if (configuredUrl) {
    try {
      const safeUrl = new URL(configuredUrl);
      if (safeUrl.username) safeUrl.username = "[REDACTED]";
      if (safeUrl.password) safeUrl.password = "[REDACTED]";
      redacted = redacted.split(configuredUrl).join(safeUrl.toString());
      const parsed = new URL(configuredUrl);
      for (const secret of [parsed.username, parsed.password]) {
        if (secret) redacted = redacted.split(decodeURIComponent(secret)).join("[REDACTED]");
      }
    } catch {
      redacted = redacted.split(configuredUrl).join("<invalid-rabbitmq-url>");
    }
  }
  return redacted
    .replace(/(amqps?:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/giu, "$1[REDACTED]@")
    .replace(/[\u0000-\u001f\u007f]+/gu, " ")
    .slice(0, 500);
}
