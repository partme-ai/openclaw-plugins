/**
 * @fileoverview Tracing 导出前的统一敏感信息边界。
 *
 * Hook、状态接口、Log/File/OTLP 后端共享同一份 Span，因此必须在写入 TraceStore 时完成清洗；
 * 不能依赖每个后端各自记得脱敏。会话类标识使用进程级随机密钥生成关联令牌，既可在一次
 * Gateway 生命周期内关联排障，又不会向外部 Collector 暴露原始业务 ID。
 */
import { createHmac, randomBytes } from "node:crypto";
import { redactSensitiveText as redactOpenClawSensitiveText } from "openclaw/plugin-sdk/security-runtime";

const identifierKey = randomBytes(32);
const IDENTIFIER_ATTRIBUTES = new Set([
  "openclaw.session_key",
  "openclaw.run_id",
  "openclaw.message_id",
  "openclaw.tool_call_id",
]);

/**
 * SDK 与插件规则取并集，避免 SDK 未覆盖任意 Bearer/sk-* 形态时发生泄漏。
 *
 * Tracing 以 ESM 发布，必须静态导入 security-runtime；CommonJS `require()` 在真实 Gateway
 * 中不存在，会让旧实现看似有 SDK 兜底、实际永远只执行本地正则。
 */
export function redactTraceText(value: string): string {
  const redacted = redactOpenClawSensitiveText(value, { mode: "tools" });
  return redacted
    .replace(/\b(Bearer|Basic|Bot)\s+[^\s,;]+/gi, "$1 [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "sk-[REDACTED]")
    .replace(
      /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd|secret)\b\s*([:=])\s*([^\s,;&]+)/gi,
      "$1$2[REDACTED]",
    )
    .replace(/[\u0000-\u001f\u007f]/g, "_")
    .slice(0, 500);
}

/** 复制并规范化 Span 属性，调用方后续修改原对象不会污染已登记 Span。 */
export function sanitizeTraceAttributes(
  attributes: Record<string, string | number | boolean> | undefined,
): Record<string, string | number | boolean> {
  if (!attributes) return {};
  return Object.fromEntries(Object.entries(attributes).map(([key, value]) => {
    if (typeof value !== "string") return [key, value];
    if (IDENTIFIER_ATTRIBUTES.has(key)) {
      const token = createHmac("sha256", identifierKey).update(value).digest("hex").slice(0, 24);
      return [key, `id_${token}`];
    }
    return [key, redactTraceText(value)];
  }));
}
