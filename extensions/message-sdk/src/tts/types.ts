/**
 * @module tts/types
 *
 * TTS 公共类型 — 所有 TTS 提供商共用。
 *
 * **关键导出**：`TTSConfig`、`TTSResult`、`TTSVoice`、`TTSProvider`
 */

// ============================================================================
// 配置
// ============================================================================

/**
 * TTS 合成配置 / Text-to-speech synthesis config.
 *
 * @property baseUrl - 远程 API 端点（OpenAI 等）
 * @property apiKey - API 密钥
 * @property model - 模型名（如 `tts-1`）
 * @property voice - 语音 ID（如 `zh-CN-XiaoxiaoNeural`）
 * @property rate - 语速字符串（EdgeTTS：-100~+100）
 * @property volume - 音量（EdgeTTS）
 * @property pitch - 音调（EdgeTTS）
 * @property outputFormat - 输出格式（默认 mp3）
 * @property timeoutMs - 超时毫秒
 * @property maxTextLength - 最大输入字符数（默认 4096）
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
 * TTS 合成结果 / Synthesized audio result.
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
 * TTS 语音描述 / Voice metadata for UI or selection.
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

/** TTS 提供商部署种类 / Remote vs local runtime */
export type TTSProviderKind = "remote" | "local";

/**
 * TTS 提供商元数据 / Provider descriptor (especially for local Python backends).
 */
export interface TTSProvider {
  readonly name: string;
  readonly kind: TTSProviderKind;
  readonly description: string;
  readonly defaultVoice: string;
}
