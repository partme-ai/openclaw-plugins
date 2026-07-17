import { redactSensitiveText as redactOpenClawSensitiveText } from "openclaw/plugin-sdk/security-runtime";

/**
 * 指标、诊断与健康响应共用的敏感信息脱敏边界。
 *
 * Prometheus 插件以 ESM 发布，不能使用 CommonJS `require()` 探测 SDK：在真实 Gateway 中
 * `require` 不存在会导致官方脱敏器永远未被调用。OpenClaw 是本插件的 peer/runtime 前提，
 * 因此直接静态导入 2026.7.1 的 security-runtime，并在其结果上叠加 exporter 专用规则。
 */
export function redactSensitiveText(value: string): string {
  const redacted = redactOpenClawSensitiveText(value, { mode: "tools" });
  // SDK 与插件规则取并集：指标标签尤其不能保留 Bearer 前后缀或常见配置凭据的片段。
  return redacted
    .replace(/\b(Bearer|Basic|Bot)\s+[^\s,;]+/gi, "$1 [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "sk-[REDACTED]")
    .replace(
      /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd|secret)\b\s*([:=])\s*([^\s,;&]+)/gi,
      "$1$2[REDACTED]",
    );
}
