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

export function extractKeywords(text: string): string[] {
  const normalized = text.toLowerCase().replace(/[^\p{Script=Han}\p{L}\p{N}]+/gu, " ");
  const tokens = normalized.split(/\s+/).filter((token) => token.length >= 2);
  for (const run of normalized.match(/[\p{Script=Han}]{3,}/gu) ?? []) {
    for (let index = 0; index < run.length - 1; index += 1) tokens.push(run.slice(index, index + 2));
  }
  return [...new Set(tokens)].slice(0, 64);
}

export function keywordScore(query: string, content: string, keywords: string[] = []): number {
  const queryWords = extractKeywords(query);
  if (queryWords.length === 0) return 0;
  const haystack = `${content.toLowerCase()} ${keywords.join(" ").toLowerCase()}`;
  const hits = queryWords.filter((word) => haystack.includes(word)).length;
  const coverage = hits / queryWords.length;
  const exactBoost = content.toLowerCase().includes(query.trim().toLowerCase()) ? 0.15 : 0;
  return Math.min(1, coverage + exactBoost);
}

