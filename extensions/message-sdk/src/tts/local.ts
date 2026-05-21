/**
 * 本地 TTS 方案（需要 Python 运行时）
 *
 * 来源：llm-study/llm-text-to-speech/ + Spring AI TTS 示例
 *
 * 这些方案质量高但需要本地 Python 环境 + GPU。
 * Node.js 中通过 child_process 调用 Python 脚本。
 * 参考实现见 llm-study/llm-text-to-speech/ 下的 Python 源码。
 */

import type { TTSProvider } from "./types.js";

// ============================================================================
// 方案 1：ChatTTS（本地，2noise/ChatTTS）
// ============================================================================
//
// 安装：pip install chattts
// 特点：支持笑声、停顿等自然韵律，中英文混读优秀
// 模型：chattts/chattts
// 参考：llm-study/llm-text-to-speech/chat-tts/

export const CHAT_TTS_PROVIDER: TTSProvider = {
  name: "chattts",
  kind: "local",
  description: "2noise/ChatTTS — 自然对话风格 TTS，支持笑声停顿韵律",
  defaultVoice: "default",
};

// ============================================================================
// 方案 2：Mars5TTS（本地，CAMB.AI）
// ============================================================================
//
// 安装：pip install mars5
// 特点：支持语音克隆（5秒参考音频即可），情感表达丰富
// 模型：CAMB-AI/MARS5-TTS
// 参考：spring-ai-examples/spring-ai-ollama-audio-mars5tts/

export const MARS5_TTS_PROVIDER: TTSProvider = {
  name: "mars5tts",
  kind: "local",
  description: "CAMB.AI/MARS5-TTS — 语音克隆 TTS，5秒参考即可",
  defaultVoice: "default",
};

// ============================================================================
// 方案 3：Qwen TTS（本地，阿里）
// ============================================================================
//
// 安装：pip install qwen-tts soundfile torch
// 特点：支持自定义声音设计（Voice Design），12Hz 超低延迟
// 模型：Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice
// 需要：CUDA GPU
// 参考：llm-study/llm-text-to-speech/qwen-tts/

export const QWEN_TTS_PROVIDER: TTSProvider = {
  name: "qwen-tts",
  kind: "local",
  description: "Qwen3-TTS-12Hz-1.7B — 阿里语音合成，支持声音设计",
  defaultVoice: "custom",
};

// ============================================================================
// 方案 4：pyttsx3（离线，零配置）
// ============================================================================
//
// 安装：pip install pyttsx3
// 特点：完全离线，零配置，使用系统自带语音引擎
//       macOS 用 nsss（系统语音），Windows 用 SAPI5，Linux 用 espeak
// 参考：llm-study/llm-text-to-speech/ollama-voice/

export const PYTTSX3_PROVIDER: TTSProvider = {
  name: "pyttsx3",
  kind: "local",
  description: "pyttsx3 — 完全离线 TTS，零配置，使用系统语音引擎",
  defaultVoice: "default",
};
