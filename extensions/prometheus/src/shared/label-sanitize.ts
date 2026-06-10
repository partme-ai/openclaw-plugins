/**
 * 共享工具函数
 */

/** 清理标签值：去除首尾空白，替换 Prometheus 非法字符，截断过长的值 */
export function sanitizeLabel(raw: string): string {
  return String(raw).trim().replace(/["\\\n]/g, "_").slice(0, 128) || "unknown";
}
