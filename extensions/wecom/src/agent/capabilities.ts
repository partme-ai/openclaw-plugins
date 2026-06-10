/**
 * @module agent/capabilities
 *
 * Agent 模式 **能力模块** 聚合导出。
 *
 * 包含：Markdown  stripping、欢迎语、ASR、语音转码、Stream 状态等。
 * 供插件注册或测试按需引用。
 */

export * from "./markdown-strip.js";
export * from "./welcome.js";
export * from "./asr.js";
export * from "./voice-transcode.js";
export * from "./stream.js";
