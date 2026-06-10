/**
 * @module tts
 *
 * TTS 模块 — 文本转语音（Text-to-Speech）。
 *
 * **远程方案**（纯 HTTP / CLI）：
 * - EdgeTTS — Microsoft 免费神经语音
 * - OpenAI TTS — tts-1 / tts-1-hd
 *
 * **本地方案**（需 Python，见 `local.ts` 元数据）：
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
