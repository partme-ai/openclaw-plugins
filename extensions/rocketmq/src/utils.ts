/**
 * RocketMQ 工具函数。
 */

/**
 * 定义 setup plugin 入口。
 */
export function defineSetupPluginEntry<TPlugin>(plugin: TPlugin): { plugin: TPlugin } {
  return { plugin };
}

/**
 * 将文本按指定长度分块，尝试在单词边界断开。
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
 * 清理纯文本，统一换行符和制表符。
 */
export function sanitizeForPlainText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\t/g, "    ").trim();
}
