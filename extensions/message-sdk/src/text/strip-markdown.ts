/**
 * @module text/strip-markdown
 *
 * Markdown → 纯文本（IM 通道不支持 Markdown 时的降级）。
 *
 * **职责**：将 Agent 输出的 Markdown 转为 IM 平台可接受的纯文本，
 * 保留可读结构（标题、列表、代码块、表格）而非简单剥离标记。
 *
 * **适用场景**：WeCom / 部分 Feishu 场景仅支持纯文本；出站前对 reply body 做降级。
 *
 * **上下游**：
 * - 上游：Agent / LLM Markdown 回复
 * - 下游：IM 平台文本消息 API
 *
 * **关键导出**：`stripMarkdown`
 */

/**
 * 去除 Markdown 格式并转为纯文本。
 *
 * 处理顺序（避免正则互相干扰）：
 * 1.  fenced code block → 缩进纯文本
 * 2. ATX 标题 → 【标题】
 * 3. 粗体/斜体/删除线/行内代码
 * 4. 列表、链接、图片
 * 5. GFM 表格 → 空格对齐纯文本
 * 6. 引用、分隔线、多余空行
 *
 * @param text - Markdown 格式文本
 * @returns 去除 Markdown 标记后的纯文本
 *
 * @example
 * ```ts
 * stripMarkdown("**你好** _world_");
 * // => "你好 world"
 * ```
 */
export function stripMarkdown(text: string): string {
  let result = text;

  // 代码块：保留内容并缩进，便于 IM 中仍可阅读
  result = result.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, lang, code) => {
    const trimmedCode = code.trim();
    if (!trimmedCode) return "";
    const langLabel = lang ? `[${lang}]\n` : "";
    const indentedCode = trimmedCode
      .split("\n")
      .map((line: string) => `    ${line}`)
      .join("\n");
    return `\n${langLabel}${indentedCode}\n`;
  });

  // ATX 标题 → 中文书名号风格，IM 中更醒目
  result = result.replace(/^#{1,6}\s+(.+)$/gm, "【$1】");

  result = result
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/(?<![\w/])_(.+?)_(?![\w/])/g, "$1");

  result = result.replace(/^[-*]\s+/gm, "· ");
  result = result.replace(/^(\d+)\.\s+/gm, "$1. ");
  result = result.replace(/`([^`]+)`/g, "$1");
  result = result.replace(/~~(.*?)~~/g, "$1");
  result = result.replace(/!\[([^\]]*)\]\([^)]+\)/g, "[图片: $1]");
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");

  // GFM 表格：按列宽对齐为空格分隔的纯文本表格
  result = result.replace(
    /\|(.+)\|\n\|[-:| ]+\|\n((?:\|.+\|\n?)*)/g,
    (_match, header, body) => {
      const headerCells = header.split("|").map((c: string) => c.trim()).filter(Boolean);
      const rows = body.trim().split("\n").map((row: string) =>
        row.split("|").map((c: string) => c.trim()).filter(Boolean),
      );

      const colWidths = headerCells.map((h: string, i: number) => {
        const maxRowWidth = Math.max(...rows.map((r: string[]) => (r[i] || "").length));
        return Math.max(h.length, maxRowWidth);
      });

      const formattedHeader = headerCells
        .map((h: string, i: number) => h.padEnd(colWidths[i]!))
        .join("  ");

      const formattedRows = rows
        .map((row: string[]) =>
          headerCells.map((_: string, i: number) => (row[i] || "").padEnd(colWidths[i]!)).join("  "),
        )
        .join("\n");

      return `${formattedHeader}\n${formattedRows}\n`;
    },
  );

  result = result.replace(/^>\s?/gm, "");
  result = result.replace(/^[-*_]{3,}$/gm, "────────────");
  // 压缩连续空行，避免 IM 消息过长空白
  result = result.replace(/\n{3,}/g, "\n\n");

  return result.trim();
}
