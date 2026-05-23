/**
 * @module util/split-utf8-bytes
 *
 * UTF-8 字节分段拆分 / Split text into UTF-8 byte-bounded chunks.
 *
 * **职责**：将长文本按 UTF-8 字节上限拆成多段，每段不超过 `maxBytes`（适用于 IM 平台
 * 单条消息字节上限，如企微客服 2048 字节）。
 *
 * **适用场景**：WeCom KF / 其他按字节计数的出站文本分片发送。
 *
 * **关键导出**：`splitUtf8TextByMaxBytes`
 */

/**
 * 将文本按 UTF-8 字节长度拆分为多个片段，每段不超过 `maxBytes`。
 *
 * 按 Unicode 标量（`for..of`）逐字符累加，避免在多字节字符中间截断。
 * 若单个字符已超过 `maxBytes`，该字符单独成段。
 *
 * @param text - 原始文本 / Source text
 * @param maxBytes - 每段 UTF-8 字节上限 / Maximum UTF-8 bytes per chunk
 * @returns 分段结果（空输入返回空数组）/ Chunk array (empty for empty input)
 *
 * @example
 * ```ts
 * splitUtf8TextByMaxBytes(longReply, 2048);
 * ```
 */
export function splitUtf8TextByMaxBytes(text: string, maxBytes: number): string[] {
  const chunks: string[] = [];
  let current = "";

  for (const char of text) {
    const candidate = current + char;
    if (Buffer.byteLength(candidate, "utf8") > maxBytes) {
      if (current) {
        chunks.push(current);
      }
      current = char;
    } else {
      current = candidate;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}
