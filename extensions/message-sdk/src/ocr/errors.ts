/**
 * OCR 错误类型
 *
 * 所有 OCR 提供商（DeepSeek、GLM、PaddleOCR、千帆等）共用此错误体系。
 * 来源：借鉴 openclaw-china ASR 错误模式 + Spring AI OCR 示例
 */

export type OCRErrorKind = "timeout" | "auth" | "request" | "response_parse" | "service" | "empty_result" | "unsupported_format";

/**
 * OCRError 表示 ocr 模块中的可实例化能力。
 *
 * 类实例通常持有内存状态或错误语义；调用方应通过公开方法读取或更新状态，
 * 不要依赖内部字段布局。
 */
export class OCRError extends Error {
  constructor(
    message: string,
    public readonly kind: OCRErrorKind,
    public readonly provider: string,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = "OCRError";
  }
}

/**
 * OCRTimeoutError 表示 ocr 模块中的可实例化能力。
 *
 * 类实例通常持有内存状态或错误语义；调用方应通过公开方法读取或更新状态，
 * 不要依赖内部字段布局。
 */
export class OCRTimeoutError extends OCRError {
  constructor(provider: string, public readonly timeoutMs: number) {
    super(`OCR request timeout after ${timeoutMs}ms`, "timeout", provider, true);
    this.name = "OCRTimeoutError";
  }
}

/**
 * OCRAuthError 表示 ocr 模块中的可实例化能力。
 *
 * 类实例通常持有内存状态或错误语义；调用方应通过公开方法读取或更新状态，
 * 不要依赖内部字段布局。
 */
export class OCRAuthError extends OCRError {
  constructor(provider: string, message: string, public readonly status?: number) {
    super(message, "auth", provider, false);
    this.name = "OCRAuthError";
  }
}

/**
 * OCRRequestError 表示 ocr 模块中的可实例化能力。
 *
 * 类实例通常持有内存状态或错误语义；调用方应通过公开方法读取或更新状态，
 * 不要依赖内部字段布局。
 */
export class OCRRequestError extends OCRError {
  constructor(provider: string, message: string, public readonly status?: number) {
    super(message, "request", provider, true);
    this.name = "OCRRequestError";
  }
}

/**
 * OCRResponseParseError 表示 ocr 模块中的可实例化能力。
 *
 * 类实例通常持有内存状态或错误语义；调用方应通过公开方法读取或更新状态，
 * 不要依赖内部字段布局。
 */
export class OCRResponseParseError extends OCRError {
  constructor(provider: string, public readonly bodySnippet: string) {
    super("OCR response is not valid JSON", "response_parse", provider, false);
    this.name = "OCRResponseParseError";
  }
}

/**
 * OCRServiceError 表示 ocr 模块中的可实例化能力。
 *
 * 类实例通常持有内存状态或错误语义；调用方应通过公开方法读取或更新状态，
 * 不要依赖内部字段布局。
 */
export class OCRServiceError extends OCRError {
  constructor(provider: string, message: string, public readonly serviceCode?: number) {
    super(message, "service", provider, false);
    this.name = "OCRServiceError";
  }
}

/**
 * OCREmptyResultError 表示 ocr 模块中的可实例化能力。
 *
 * 类实例通常持有内存状态或错误语义；调用方应通过公开方法读取或更新状态，
 * 不要依赖内部字段布局。
 */
export class OCREmptyResultError extends OCRError {
  constructor(provider: string) {
    super("OCR returned empty result", "empty_result", provider, false);
    this.name = "OCREmptyResultError";
  }
}

/**
 * OCRUnsupportedFormatError 表示 ocr 模块中的可实例化能力。
 *
 * 类实例通常持有内存状态或错误语义；调用方应通过公开方法读取或更新状态，
 * 不要依赖内部字段布局。
 */
export class OCRUnsupportedFormatError extends OCRError {
  constructor(provider: string, public readonly format: string) {
    super(`Unsupported image format: ${format}`, "unsupported_format", provider, false);
    this.name = "OCRUnsupportedFormatError";
  }
}
