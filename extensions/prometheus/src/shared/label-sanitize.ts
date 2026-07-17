/**
 * 共享工具函数
 */

import { redactSensitiveText } from "../diagnostics/redact.js";

/**
 * 清理标签值：先使用 OpenClaw 安全规则脱敏，再移除控制字符并限制长度。
 *
 * Collector、Hook 与 Gateway RPC 都可能提供标签；不能只依赖各采集器“记得调用”本函数，
 * 因此注册表和最终 scrape 边界还会再次执行该规范化。
 */
export function sanitizeLabel(raw: string): string {
  const redacted = redactSensitiveText(String(raw).trim());
  return redacted
    .replace(/[\u0000-\u001f\u007f"\\]/g, "_")
    .slice(0, 128) || "unknown";
}
