/**
 * 文本分块与纯文本清理（出站消息用）。
 */

/**
 * 将文本按长度分块，尽量在换行或空格处断开。
 */
export function chunkText(text: string, limit: number): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + limit, text.length);

    if (end < text.length) {
      const lastNewline = text.lastIndexOf("\n", end);
      if (lastNewline > start) {
        end = lastNewline + 1;
      } else {
        const lastSpace = text.lastIndexOf(" ", end);
        if (lastSpace > start) {
          end = lastSpace + 1;
        }
      }
    }

    chunks.push(text.slice(start, end));
    start = end;
  }

  return chunks;
}

/**
 * 规范化纯文本（换行与制表符）。
 */
export function sanitizeForPlainText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\t/g, "    ")
    .trim();
}
