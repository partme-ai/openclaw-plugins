/**
 * @module agent/markdown-strip
 *
 * Agent 出站文本 Markdown  stripping 适配层。
 *
 * 企业微信 Agent 文本消息不支持 Markdown 渲染，发送前需剥离格式符号。
 * 实现复用 message-sdk 的 `stripMarkdown`，本模块仅作 wecom agent 域内 re-export。
 */

export { stripMarkdown } from "@partme.ai/openclaw-message-sdk/text";
