/**
 * Formats current local time as `yyyyMMddHHmmss` (14 digits, no separators).
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
