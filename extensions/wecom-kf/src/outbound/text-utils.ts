/**
 * @file WeCom KF 文本处理工具 —— Markdown 清理与字节感知切分。
 *
 * @description KF API 不支持 Markdown 格式，发送前需 strip markdown；
 * 同时单条消息有 2048 字节上限，需按字节切分。
 *
 * @module outbound/text-utils
 */

/**
 * 剥离常见 Markdown 语法，保留可读文本内容。
 * 代码块缩进为 4 空格，标题转为【】，列表转为 ·，链接保留文字 (URL)。
 */
export function stripMarkdown(text: string): string {
  let result = text;
  // 代码块 → 缩进
  result = result.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, lang, code) => {
    const tc = String(code).trim();
    if (!tc) return "";
    const header = lang ? `[${lang}]\n` : "";
    const indented = tc.split("\n").map(l => `    ${l}`).join("\n");
    return `\n${header}${indented}\n`;
  });
  // 标题 # → 【】
  result = result.replace(/^#{1,6}\s+(.+)$/gm, "【$1】");
  // 粗体/斜体/删除线
  result = result.replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/(?<![\w/])_(.+?)_(?![\\w/])/g, "$1")
    .replace(/~~(.*?)~~/g, "$1");
  // 列表符号
  result = result.replace(/^[-*]\s+/gm, "· ");
  result = result.replace(/^(\d+)\.\s+/gm, "$1. ");
  // 行内代码
  result = result.replace(/`([^`]+)`/g, "$1");
  // 链接 [text](url) → text (url)
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");
  // 图片 ![alt](url) → [图片: alt]
  result = result.replace(/!\[([^\]]*)\]\([^)]+\)/g, "[图片: $1]");
  // 引用
  result = result.replace(/^>\s?/gm, "");
  // 分隔线
  result = result.replace(/^[-*_]{3,}$/gm, "────────────");
  // 多余空行
  result = result.replace(/\n{3,}/g, "\n\n");
  return result.trim();
}

/**
 * 按 UTF-8 字节数切分文本，避免 KF API 的 2048 字节上限。
 * 逐字符扫描，在不超过 maxBytes 处切分，不破坏字符边界。
 */
export function splitMessageByBytes(text: string, maxBytes = 2048): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const char of text) {
    const candidate = current + char;
    if (Buffer.byteLength(candidate, "utf8") > maxBytes) {
      if (current) chunks.push(current);
      current = char;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * 对文本执行 stripMarkdown 后按字节切分，返回适合 KF send_msg 的分块。
 */
export function prepareKfOutboundText(text: string, maxBytes = 2048): string[] {
  return splitMessageByBytes(stripMarkdown(text), maxBytes);
}
