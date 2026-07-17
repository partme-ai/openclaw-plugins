/**
 * 零外部模型的文本归一化与词法评分。
 *
 * 中文连续文本额外生成二元词，弥补按空白分词无法召回中文短语的问题；评分由查询词
 * 覆盖率和完整短语小幅加权组成，结果稳定可解释，但不等同于向量语义检索。
 */
export function normalizeMessageContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const value = part as { type?: unknown; text?: unknown };
      return value.type === "text" && typeof value.text === "string" ? value.text : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

/**
 * 提取稳定、去重且有上限的词法关键词；中文连续文本额外生成二元词以支持无空格召回。
 */
export function extractKeywords(text: string): string[] {
  const normalized = text.toLowerCase().replace(/[^\p{Script=Han}\p{L}\p{N}]+/gu, " ");
  const tokens = normalized.split(/\s+/).filter((token) => token.length >= 2);
  for (const run of normalized.match(/[\p{Script=Han}]{3,}/gu) ?? []) {
    for (let index = 0; index < run.length - 1; index += 1) tokens.push(run.slice(index, index + 2));
  }
  return [...new Set(tokens)].slice(0, 64);
}

/**
 * 计算可解释的词法相关度：查询词覆盖率为主体，完整短语命中最多增加 0.15。
 * 返回值限制在 0～1；它不是向量相似度，也不会产生跨语义推断。
 */
export function keywordScore(query: string, content: string, keywords: string[] = []): number {
  const queryWords = extractKeywords(query);
  if (queryWords.length === 0) return 0;
  const haystack = `${content.toLowerCase()} ${keywords.join(" ").toLowerCase()}`;
  const hits = queryWords.filter((word) => haystack.includes(word)).length;
  const coverage = hits / queryWords.length;
  const exactBoost = content.toLowerCase().includes(query.trim().toLowerCase()) ? 0.15 : 0;
  return Math.min(1, coverage + exactBoost);
}
