/**
 * @module reply/format-thinking-blocks
 *
 * LLM 输出中 `<think>` 块的占位与还原（通用 IM 出站预处理）。
 *
 * **职责**：在 markdown / 媒体解析前将 thinking 块替换为占位符，处理完成后再还原，
 * 避免正则或 markdown 转换误伤 thinking 内容。
 *
 * **适用场景**：WeCom / Feishu 等与 OpenClaw 出站管线对齐的 thinking 块处理。
 *
 * **关键导出**：`maskThinkingBlocks`、`restoreThinkingBlocks`、`DEFAULT_THINK_REGEX`
 */

/** 默认 thinking 块正则（对齐 WeCom / Feishu 出站管线）。 */
export const DEFAULT_THINK_REGEX = /<think>([\s\S]*?)<\/think>/g;

/**
 * thinking 块掩码处理结果。
 *
 * @property text - 占位符替换后的文本
 * @property placeholders - 按索引保存的原始 thinking 块，供 restore 使用
 */
export type MaskThinkingBlocksResult = {
  text: string;
  placeholders: string[];
};

/**
 * 将 thinking 块替换为占位符，避免后续 markdown / 媒体解析误伤。
 *
 * @param text - 原始 Agent 输出文本
 * @param regex - thinking 块匹配正则，默认 `DEFAULT_THINK_REGEX`
 * @returns 掩码后的文本与占位符数组
 *
 * @example
 * ```ts
 * const { text, placeholders } = maskThinkingBlocks(agentOutput);
 * const processed = convertMarkdown(text);
 * const restored = restoreThinkingBlocks(processed, placeholders);
 * ```
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
 *
 * @param text - 已处理文本（含 `__THINK_PLACEHOLDER_N__`）
 * @param placeholders - `maskThinkingBlocks` 返回的原始块数组
 * @returns 还原 thinking 块后的最终文本
 */
export function restoreThinkingBlocks(text: string, placeholders: string[]): string {
  let out = text;
  for (let i = 0; i < placeholders.length; i++) {
    out = out.replace(`__THINK_PLACEHOLDER_${i}__`, placeholders[i]!);
  }
  return out;
}
