/**
 * @fileoverview RocketMQ 诊断错误脱敏。
 *
 * SDK、代理或网关错误可能回显 ACL 凭证，甚至把整个 sessionCredentials 对象拼入消息。
 * 所有进入日志和健康状态的第三方错误必须先经过这里，业务判断只使用稳定原因码。
 */
import type { RockermqConfig } from "../config.js";

/** 将 RocketMQ ACL 凭证、常见键值表达式和控制字符从诊断文本中移除。 */
export function redactRocketmqError(
  value: unknown,
  activeConfig?: Pick<RockermqConfig, "sessionCredentials">,
): string {
  let text = value instanceof Error ? value.message : String(value);
  const credentials = activeConfig?.sessionCredentials;
  for (const secret of [
    credentials?.accessKey,
    credentials?.accessSecret,
    credentials?.securityToken,
  ]) {
    if (secret) text = text.split(secret).join("***");
  }
  text = text
    .replace(
      /\b(accessKey|accessSecret|secretKey|securityToken|sessionToken)\b\s*[:=]\s*["']?[^\s,"'};]+/gi,
      "$1=***",
    )
    .replace(/[\r\n\t\u0000-\u001f\u007f]/g, " ")
    .trim();
  return text.slice(0, 500);
}
