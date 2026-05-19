/**
 * 工具函数
 */

/**
 * 将文本分块
 */
export function chunkText(text: string, limit: number): string[] {
  const chunks: string[] = [];
  let start = 0;
  
  while (start < text.length) {
    let end = Math.min(start + limit, text.length);
    
    // 尝试在单词边界或句子边界断开
    if (end < text.length) {
      // 查找最后一个换行符
      const lastNewline = text.lastIndexOf("\n", end);
      if (lastNewline > start) {
        end = lastNewline + 1;
      } else {
        // 查找最后一个空格
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
 * 清理纯文本
 */
export function sanitizeForPlainText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\t/g, "    ")
    .trim();
}
