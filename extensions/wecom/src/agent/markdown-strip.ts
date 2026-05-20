/**
 * Markdown Stripping - Agent Mode Capability
 *
 * Converts Markdown to plain text for WeCom text messages
 * WeCom text messages don't support Markdown formatting
 *
 * Source: wecom-app stripMarkdown function
 */

/**
 * Strip Markdown formatting and convert to plain text
 * @param text - Markdown formatted text
 * @returns Plain text with Markdown formatting removed
 */
export function stripMarkdown(text: string): string {
  let result = text;

  // 1. Code blocks: extract content and indent (preserve language identifier)
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

  // 2. Headers: mark with 【】
  result = result.replace(/^#{1,6}\s+(.+)$/gm, "【$1】");

  // 3. Bold/italic: keep text (exclude underscores in URLs)
  result = result
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    // Only replace standalone italic markers (with space/punctuation before/after)
    .replace(/(?<![\w/])_(.+?)_(?![\w/])/g, "$1");

  // 4. Unordered list items to bullets
  result = result.replace(/^[-*]\s+/gm, "· ");

  // 5. Ordered lists keep numbering
  result = result.replace(/^(\d+)\.\s+/gm, "$1. ");

  // 6. Inline code keep content
  result = result.replace(/`([^`]+)`/g, "$1");

  // 7. Strikethrough
  result = result.replace(/~~(.*?)~~/g, "$1");

  // 8. Links: keep text and URL
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");

  // 9. Images: show alt text
  result = result.replace(/!\[([^\]]*)\]\([^)]+\)/g, "[图片: $1]");

  // 10. Tables: simplify to aligned text
  result = result.replace(
    /\|(.+)\|\n\|[-:| ]+\|\n((?:\|.+\|\n?)*)/g,
    (_match, header, body) => {
      const headerCells = header.split("|").map((c: string) => c.trim()).filter(Boolean);
      const rows = body.trim().split("\n").map((row: string) =>
        row.split("|").map((c: string) => c.trim()).filter(Boolean)
      );

      // Calculate max width for each column
      const colWidths = headerCells.map((h: string, i: number) => {
        const maxRowWidth = Math.max(...rows.map((r: string[]) => (r[i] || "").length));
        return Math.max(h.length, maxRowWidth);
      });

      // Format header
      const formattedHeader = headerCells
        .map((h: string, i: number) => h.padEnd(colWidths[i]!))
        .join("  ");

      // Format data rows
      const formattedRows = rows
        .map((row: string[]) =>
          headerCells.map((_: string, i: number) =>
            (row[i] || "").padEnd(colWidths[i]!)
          ).join("  ")
        )
        .join("\n");

      return `${formattedHeader}\n${formattedRows}\n`;
    }
  );

  // 11. Blockquotes: remove > prefix
  result = result.replace(/^>\s?/gm, "");

  // 12. Horizontal rules
  result = result.replace(/^[-*_]{3,}$/gm, "────────────");

  // 13. Merge multiple newlines
  result = result.replace(/\n{3,}/g, "\n\n");

  return result.trim();
}
