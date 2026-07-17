/**
 * @module tts
 *
 * TTS 模块 — 文本转语音（Text-to-Speech）。
 *
 * **可执行实现**：
 * - OpenAI TTS — 官方 `/audio/speech` HTTP API
 * - EdgeTTS — 本机 `edge-tts` Python CLI（不是远程零依赖 HTTP provider）
 *
 * **仅元数据描述**（见 `local.ts`，不包含合成函数）：
 * - ChatTTS、Mars5TTS、Qwen TTS、pyttsx3
 *
 * **关键导出**：`synthesizeEdgeTTS`、`synthesizeOpenAI`、本地 Provider 常量
 */

export * from "./errors.js";
export * from "./types.js";
export { synthesizeEdgeTTS, EDGE_TTS_VOICES } from "./edge-tts.js";
export { synthesizeOpenAI } from "./openai.js";
export {
  CHAT_TTS_PROVIDER,
  MARS5_TTS_PROVIDER,
  QWEN_TTS_PROVIDER,
  PYTTSX3_PROVIDER,
} from "./local.js";
