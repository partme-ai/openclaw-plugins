/**
 * LLM 输出中 redacted_thinking 块的占位与还原（通用 IM 出站预处理）。
 */

/** 默认 thinking 块正则（对齐 WeCom / Feishu 出站管线）。 */
export const DEFAULT_THINK_REGEX = /<think>([\s\S]*?)<\/think>/g;

export type MaskThinkingBlocksResult = {
  text: string;
  placeholders: string[];
};

/**
 * 将 thinking 块替换为占位符，避免后续 markdown / 媒体解析误伤。
 */
export function maskThinkingBlocks(
  text: string,
  regex: RegExp = DEFAULT_THINK_REGEX,
): MaskThinkingBlocksResult {
  const placeholders: string[] = [];
  const masked = text.replace(regex, (match) => {
    placeholders.push(match);
    return `__THINK_PLACEHOLDER_${placeholders.length - 1}__`;
  });
  return { text: masked, placeholders };
}

/**
 * 在 markdown 等处理完成后还原 thinking 占位符。
 */
export function restoreThinkingBlocks(text: string, placeholders: string[]): string {
  let out = text;
  for (let i = 0; i < placeholders.length; i++) {
    out = out.replace(`__THINK_PLACEHOLDER_${i}__`, placeholders[i]!);
  }
  return out;
}
