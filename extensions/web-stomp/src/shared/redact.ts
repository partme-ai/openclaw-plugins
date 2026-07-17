/**
 * @fileoverview Web-STOMP 运行诊断脱敏。
 *
 * WebSocket、TLS 与 Agent Runtime 的错误都可能包含 URL 用户信息、认证头或 Token。
 * 这些内容不得进入 Gateway 日志、Channel 状态，更不能通过 STOMP ERROR 帧返回外部客户端。
 */

import { redactSensitiveText as redactOpenClawSensitiveText } from "openclaw/plugin-sdk/security-runtime";

const REDACTED = "[REDACTED]";

/** 把未知异常压平为最多 500 字符的单行安全诊断。 */
export function redactWebStompError(value: unknown): string {
  // 插件以 ESM 发布；静态导入可保证正式 Gateway 一定执行 OpenClaw 官方脱敏规则。
  const official = redactOpenClawSensitiveText(
    value instanceof Error ? value.message : String(value),
    { mode: "tools" },
  );
  const sanitized = official
    .replace(/([a-z][a-z\d+.-]*:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/gi, `$1${REDACTED}@`)
    .replace(/\b(authorization|proxy-authorization|passcode)\s*[:=]\s*(?:bearer\s+|basic\s+)?[^\s,;]+/gi, `$1=${REDACTED}`)
    .replace(/\b(bearer|basic|bot)\s+[^\s,;]+/gi, `$1 ${REDACTED}`)
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "sk-[REDACTED]")
    .replace(/([?&](?:access_token|refresh_token|token|api[_-]?key|client_secret|password)=)[^&#\s]*/gi, `$1${REDACTED}`)
    .replace(/\b(access[_-]?token|refresh[_-]?token|api[_-]?key|client[_-]?secret|password|secret)\b\s*[:=]\s*["']?[^\s,;"'}]+["']?/gi, `$1=${REDACTED}`)
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim();
  return sanitized.slice(0, 500) || "unknown error";
}
