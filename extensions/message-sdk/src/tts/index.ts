/**
 * TTS 模块 — 文本转语音（Text-to-Speech）
 *
 * 远程方案（纯 HTTP，TypeScript 直接调用）：
 * - EdgeTTS：      Microsoft Edge 免费 TTS，300+ 神经语音
 * - OpenAI TTS：    tts-1/tts-1-hd，6 种内置语音
 *
 * 本地方案（需要 Python 运行时，通过 child_process 调用）：
 * - ChatTTS：      2noise/ChatTTS，自然对话风格
 * - Mars5TTS：     CAMB.AI，语音克隆（5秒参考音频）
 * - Qwen TTS：     阿里 Qwen3-TTS，声音设计
 * - pyttsx3：      完全离线，系统语音引擎
 *
 * 来源：llm-study/llm-text-to-speech/ + Spring AI / LangChain4j TTS 示例
 *
 * 新增 TTS 提供商：
 *   1. import { TTSError } from "./errors.js"
 *   2. 实现 synthesizeXxx() 函数
 *   3. 在 index.ts 中 export
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
