/**
 * TTS 公共类型
 *
 * 所有 TTS 提供商共用此接口定义。
 * 来源：借鉴 Spring AI / LangChain4j TTS 示例 + llm-study TTS 模块
 */

// ============================================================================
// 配置
// ============================================================================

/**
 * TTSConfig 描述 tts 模块公开 API 的结构化参数或返回值。
 *
 * 字段命名保持贴近业务语义，便于通道插件在不复制 SDK 实现的情况下组合能力。
 */
export interface TTSConfig {
  /** API 端点 URL（远程模式） */
  baseUrl?: string;
  /** API 密钥（远程模式） */
  apiKey?: string;
  /** 模型名称 */
  model?: string;
  /** 语音名称（如 zh-CN-XiaoxiaoNeural） */
  voice?: string;
  /** 语速 (-100 到 +100, 默认 0) */
  rate?: string;
  /** 音量 (-100 到 +100, 默认 0) */
  volume?: string;
  /** 音调 (-100 到 +100, 默认 0) */
  pitch?: string;
  /** 输出格式 (mp3/wav/ogg, 默认 mp3) */
  outputFormat?: "mp3" | "wav" | "ogg" | "opus" | "aac" | "flac";
  /** 超时时间（毫秒），默认 30000 */
  timeoutMs?: number;
  /** 最大文本长度（字符），默认 4096 */
  maxTextLength?: number;
}

// ============================================================================
// 结果
// ============================================================================

/**
 * TTSResult 描述 tts 模块公开 API 的结构化参数或返回值。
 *
 * 字段命名保持贴近业务语义，便于通道插件在不复制 SDK 实现的情况下组合能力。
 */
export interface TTSResult {
  /** 音频数据（Buffer） */
  audio: Buffer;
  /** 输出格式 */
  format: string;
  /** 提供商名称 */
  provider: string;
  /** 使用的语音 */
  voice: string;
  /** 处理耗时（毫秒） */
  elapsedMs: number;
  /** 音频时长（秒，可选） */
  durationSeconds?: number;
}

// ============================================================================
// 语音列表
// ============================================================================

/**
 * TTSVoice 描述 tts 模块公开 API 的结构化参数或返回值。
 *
 * 字段命名保持贴近业务语义，便于通道插件在不复制 SDK 实现的情况下组合能力。
 */
export interface TTSVoice {
  /** 语音短名（如 zh-CN-XiaoxiaoNeural） */
  shortName: string;
  /** 友好名称 */
  friendlyName?: string;
  /** 语言/地区（如 zh-CN） */
  locale: string;
  /** 性别（Male/Female/Neutral） */
  gender?: string;
  /** 语音风格列表 */
  styles?: string[];
}

// ============================================================================
// 提供商类型
// ============================================================================

/** TTS 提供商种类 */
export type TTSProviderKind = "remote" | "local";

/**
 * TTSProvider 描述 tts 模块公开 API 的结构化参数或返回值。
 *
 * 字段命名保持贴近业务语义，便于通道插件在不复制 SDK 实现的情况下组合能力。
 */
export interface TTSProvider {
  readonly name: string;
  readonly kind: TTSProviderKind;
  readonly description: string;
  readonly defaultVoice: string;
}
