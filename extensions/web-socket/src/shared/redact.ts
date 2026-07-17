/**
 * WebSocket 传输错误的统一脱敏边界。
 *
 * 握手错误可能回显 URL userinfo、Bearer Header 或配置 Token；进入日志和 Gateway 状态前
 * 必须遮蔽凭据、移除控制字符并限制长度，避免第三方错误对象泄漏秘密或污染日志。
 */
import type { WebsocketChannelConfig } from "../types.js";

export function redactWebSocketError(value: unknown, config?: WebsocketChannelConfig | null): string {
  let redacted = value instanceof Error ? value.message : String(value);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("openclaw/plugin-sdk/security-runtime") as {
      redactSensitiveText?: (text: string) => string;
    };
    if (typeof mod.redactSensitiveText === "function") redacted = mod.redactSensitiveText(redacted);
  } catch {
    // 独立测试不要求安装 OpenClaw，继续应用插件本地规则。
  }
  const secrets = [
    config?.server.auth.token,
    ...(config?.server.auth.tokens ?? []),
    config?.client.token,
    ...Object.values(config?.client.headers ?? {}),
  ].filter((secret): secret is string => Boolean(secret));
  for (const secret of secrets) redacted = redacted.split(secret).join("[REDACTED]");
  return redacted
    .replace(/(wss?:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/giu, "$1[REDACTED]@")
    .replace(/Bearer\s+\S+/giu, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gu, "sk-[REDACTED]")
    .replace(/[\u0000-\u001f\u007f]+/gu, " ")
    .slice(0, 500);
}
