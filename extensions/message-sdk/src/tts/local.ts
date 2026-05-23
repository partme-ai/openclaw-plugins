/**
 * @module tts/local
 *
 * 本地 TTS 方案元数据（需要 Python 运行时）。
 *
 * **说明**：这些方案通过 `child_process` 调用 Python 脚本实现；
 * 本文件仅导出 {@link TTSProvider} 描述符，供通道配置与文档引用。
 *
 * **参考**：llm-study/llm-text-to-speech/
 *
 * **关键导出**：`CHAT_TTS_PROVIDER`、`MARS5_TTS_PROVIDER`、`QWEN_TTS_PROVIDER`、`PYTTSX3_PROVIDER`
 */

import type { TTSProvider } from "./types.js";

// ============================================================================
// 方案 1：ChatTTS（本地，2noise/ChatTTS）
// ============================================================================
//
// 安装：pip install chattts
// 特点：支持笑声、停顿等自然韵律，中英文混读优秀

/** ChatTTS 本地提供商描述 / ChatTTS local provider metadata */
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
// 特点：语音克隆（5 秒参考音频）

/** Mars5TTS 本地提供商描述 */
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
// 模型：Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice

/** Qwen TTS 本地提供商描述 */
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
// 特点：完全离线，使用系统语音引擎

/** pyttsx3 离线提供商描述 */
export const PYTTSX3_PROVIDER: TTSProvider = {
  name: "pyttsx3",
  kind: "local",
  description: "pyttsx3 — 完全离线 TTS，零配置，使用系统语音引擎",
  defaultVoice: "default",
};
