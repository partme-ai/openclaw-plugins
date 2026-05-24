/**
 * @module nacos/shared/format-timestamp
 *
 * @fileoverview 本地时间格式化为 `yyyyMMddHHmmss`（14 位，无分隔符）。
 */

/**
 * 将日期格式化为备份文件名常用的时间戳字符串。
 *
 * @param d - 待格式化日期，默认当前时间
 * @returns 形如 `20260524153045` 的 14 位字符串
 */
export function formatTimestampYyyyMMddHHmmss(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    String(d.getFullYear()) +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}
