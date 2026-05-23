/**
 * @module ocr/types
 *
 * OCR 公共类型 — 所有 OCR 提供商共用。
 *
 * **关键导出**：`OCRConfig`、`OCRInput`、`OCRResult`、`OCRProvider`
 */

// ============================================================================
// 配置
// ============================================================================

/**
 * OCR 提供商连接配置 / Provider connection config.
 *
 * @property baseUrl - API 端点 URL
 * @property apiKey - API 密钥
 * @property model - 模型名称（各提供商默认不同）
 * @property timeoutMs - 超时毫秒（默认 30000）
 * @property maxImageBytes - 最大图片字节（默认 10MB）
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
 * OCR 输入 — 三选一提供图片 / Image input (provide one of url/base64/filePath).
 *
 * @property url - 图片 HTTP(S) URL
 * @property base64 - Base64 编码图片数据
 * @property filePath - 本地文件路径（部分提供商支持）
 * @property mimeType - 与 base64 配合的 MIME（默认 `image/png`）
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
 * 识别到的词 / Recognized word with optional bbox.
 *
 * @property text - 词文本
 * @property confidence - 置信度 0–1
 * @property bbox - 边界框 [x1, y1, x2, y2]（可选）
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
 * 识别到的行 / Line of text with words.
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
 * 文本块 / Block containing lines.
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
 * OCR 统一结果 / Normalized OCR result across providers.
 *
 * @property text - 完整识别文本
 * @property blocks - 结构化块列表
 * @property provider - 提供商标识
 * @property model - 使用的模型名
 * @property elapsedMs - 处理耗时毫秒
 * @property imageSize - 原图尺寸（可选）
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
 * OCR 提供商契约 / OCR provider plugin interface.
 */
export interface OCRProvider {
  readonly name: string;
  readonly defaultModel: string;
  recognize(input: OCRInput, config: OCRConfig): Promise<OCRResult>;
}
