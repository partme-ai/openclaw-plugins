/**
 * @module util/truncate-utf8-bytes
 *
 * UTF-8 字节截断（保留尾部）/ UTF-8 byte truncation keeping the tail segment.
 *
 * **职责**：将字符串截断至不超过指定 UTF-8 字节数，保留**尾部**内容（适用于 IM 平台
 * 按字节上限截断长回复时保留最新片段）。
 *
 * **适用场景**：WeCom / Feishu 等通道出站文本按平台字节上限裁剪。
 *
 * **上下游**：
 * - 上游：reply / serialize 管线
 * - 下游：Node.js `Buffer` UTF-8 编解码
 *
 * **关键导出**：`truncateUtf8Bytes`
 */

/**
 * 将文本截断至不超过 maxBytes 的 UTF-8 字节数（保留尾部）。
 *
 * 若原文未超限，原样返回；超限时取 Buffer 尾部 `maxBytes` 字节再解码为字符串。
 * 注意：截断点可能落在多字节字符中间，解码结果可能含替换字符。
 *
 * @param text - 原始文本 / Source text
 * @param maxBytes - UTF-8 字节上限 / Maximum UTF-8 byte length
 * @returns 截断后的文本 / Truncated text
 *
 * @example
 * ```ts
 * truncateUtf8Bytes(longReply, 2048);
 * ```
 */
export function truncateUtf8Bytes(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= maxBytes) {
    return text;
  }
  const slice = buf.subarray(buf.length - maxBytes);
  return slice.toString("utf8");
}
