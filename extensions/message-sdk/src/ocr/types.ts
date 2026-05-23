/**
 * OCR 公共类型
 *
 * 所有 OCR 提供商共用此接口定义。
 * 来源：借鉴 Spring AI OCR 示例 (spring-ai-ollama-ocr-*)
 */

import type { OCRError } from "./errors.js";

// ============================================================================
// 配置
// ============================================================================

/**
 * OCRConfig 描述 ocr 模块公开 API 的结构化参数或返回值。
 *
 * 字段命名保持贴近业务语义，便于通道插件在不复制 SDK 实现的情况下组合能力。
 */
export interface OCRConfig {
  /** API 端点 URL */
  baseUrl: string;
  /** API 密钥 */
  apiKey: string;
  /** 模型名称 */
  model?: string;
  /** 超时时间（毫秒），默认 30000 */
  timeoutMs?: number;
  /** 最大图片大小（字节），默认 10MB */
  maxImageBytes?: number;
}

// ============================================================================
// 输入
// ============================================================================

/**
 * OCRInput 描述 ocr 模块公开 API 的结构化参数或返回值。
 *
 * 字段命名保持贴近业务语义，便于通道插件在不复制 SDK 实现的情况下组合能力。
 */
export interface OCRInput {
  /** 图片 URL (http/https) */
  url?: string;
  /** 图片 base64 数据 */
  base64?: string;
  /** 本地文件路径 */
  filePath?: string;
  /** 图片 MIME 类型 */
  mimeType?: string;
}

// ============================================================================
// 结果
// ============================================================================

/**
 * OCRWord 描述 ocr 模块公开 API 的结构化参数或返回值。
 *
 * 字段命名保持贴近业务语义，便于通道插件在不复制 SDK 实现的情况下组合能力。
 */
export interface OCRWord {
  /** 识别的文字 */
  text: string;
  /** 置信度 (0-1) */
  confidence: number;
  /** 边界框 [x1, y1, x2, y2]（可选） */
  bbox?: [number, number, number, number];
}

/**
 * OCRLine 描述 ocr 模块公开 API 的结构化参数或返回值。
 *
 * 字段命名保持贴近业务语义，便于通道插件在不复制 SDK 实现的情况下组合能力。
 */
export interface OCRLine {
  /** 行文本 */
  text: string;
  /** 置信度 (0-1) */
  confidence: number;
  /** 行内的词列表 */
  words: OCRWord[];
  /** 边界框（可选） */
  bbox?: [number, number, number, number];
}

/**
 * OCRBlock 描述 ocr 模块公开 API 的结构化参数或返回值。
 *
 * 字段命名保持贴近业务语义，便于通道插件在不复制 SDK 实现的情况下组合能力。
 */
export interface OCRBlock {
  /** 块文本 */
  text: string;
  /** 置信度 (0-1) */
  confidence: number;
  /** 块内的行列表 */
  lines: OCRLine[];
  /** 边界框（可选） */
  bbox?: [number, number, number, number];
}

/**
 * OCRResult 描述 ocr 模块公开 API 的结构化参数或返回值。
 *
 * 字段命名保持贴近业务语义，便于通道插件在不复制 SDK 实现的情况下组合能力。
 */
export interface OCRResult {
  /** 完整识别文本 */
  text: string;
  /** 块列表 */
  blocks: OCRBlock[];
  /** 提供商名称 */
  provider: string;
  /** 使用的模型 */
  model: string;
  /** 处理耗时（毫秒） */
  elapsedMs: number;
  /** 图片尺寸 */
  imageSize?: { width: number; height: number };
}

// ============================================================================
// 提供商接口
// ============================================================================

/**
 * OCRProvider 描述 ocr 模块公开 API 的结构化参数或返回值。
 *
 * 字段命名保持贴近业务语义，便于通道插件在不复制 SDK 实现的情况下组合能力。
 */
export interface OCRProvider {
  readonly name: string;
  readonly defaultModel: string;
  recognize(input: OCRInput, config: OCRConfig): Promise<OCRResult>;
}
