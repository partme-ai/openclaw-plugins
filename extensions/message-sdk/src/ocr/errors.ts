/**
 * @module ocr/errors
 *
 * OCR 错误类型 — DeepSeek、GLM、PaddleOCR、千帆等共用。
 *
 * **关键导出**：`OCRError` 及子类、`OCRErrorKind`
 */

/** OCR 错误种类 / OCR error classification */
export type OCRErrorKind = "timeout" | "auth" | "request" | "response_parse" | "service" | "empty_result" | "unsupported_format";

/**
 * OCR 基础错误 / Base error for all OCR providers.
 *
 * @property kind - 错误分类
 * @property provider - 提供商标识
 * @property retryable - 是否建议重试
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

/** 请求超时（可重试）/ Request timed out */
export class OCRTimeoutError extends OCRError {
  constructor(provider: string, public readonly timeoutMs: number) {
    super(`OCR request timeout after ${timeoutMs}ms`, "timeout", provider, true);
    this.name = "OCRTimeoutError";
  }
}

/** 鉴权失败 / Authentication failed */
export class OCRAuthError extends OCRError {
  constructor(provider: string, message: string, public readonly status?: number) {
    super(message, "auth", provider, false);
    this.name = "OCRAuthError";
  }
}

/** HTTP/传输失败（可重试）/ Transport failure */
export class OCRRequestError extends OCRError {
  constructor(provider: string, message: string, public readonly status?: number) {
    super(message, "request", provider, true);
    this.name = "OCRRequestError";
  }
}

/** 响应非合法 JSON / Invalid JSON response */
export class OCRResponseParseError extends OCRError {
  constructor(provider: string, public readonly bodySnippet: string) {
    super("OCR response is not valid JSON", "response_parse", provider, false);
    this.name = "OCRResponseParseError";
  }
}

/** 服务商业务错误 / Service-level error */
export class OCRServiceError extends OCRError {
  constructor(provider: string, message: string, public readonly serviceCode?: number) {
    super(message, "service", provider, false);
    this.name = "OCRServiceError";
  }
}

/** 识别结果为空 / Empty OCR result */
export class OCREmptyResultError extends OCRError {
  constructor(provider: string) {
    super("OCR returned empty result", "empty_result", provider, false);
    this.name = "OCREmptyResultError";
  }
}

/** 不支持的图片格式 / Unsupported image format */
export class OCRUnsupportedFormatError extends OCRError {
  constructor(provider: string, public readonly format: string) {
    super(`Unsupported image format: ${format}`, "unsupported_format", provider, false);
    this.name = "OCRUnsupportedFormatError";
  }
}
