/**
 * @module text
 *
 * text 模块 barrel export — IM 纯文本降级工具。
 *
 * **职责**：提供不支持 Markdown 的 IM 通道所需的文本预处理能力。
 *
 * **关键导出**：`stripMarkdown`
 *
 * **上下游**：
 * - 上游：Agent Markdown 回复、富文本中间态
 * - 下游：WeCom / 纯文本 IM 出站 API
 */

export { stripMarkdown } from "./strip-markdown.js";
