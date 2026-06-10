/**
 * @module tts/errors
 *
 * TTS 错误类型 — 所有 TTS 提供商共用。
 *
 * **关键导出**：`TTSError` 及子类、`TTSErrorKind`
 */

/** TTS 错误种类 / TTS error classification */
export type TTSErrorKind = "timeout" | "auth" | "request" | "response_parse" | "service" | "empty_result";

/**
 * TTS 基础错误 / Base error for all TTS providers.
 */
export class TTSError extends Error {
  constructor(
    message: string,
    public readonly kind: TTSErrorKind,
    public readonly provider: string,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = "TTSError";
  }
}

/** 请求超时（可重试） */
export class TTSTimeoutError extends TTSError {
  constructor(provider: string, public readonly timeoutMs: number) {
    super(`TTS request timeout after ${timeoutMs}ms`, "timeout", provider, true);
    this.name = "TTSTimeoutError";
  }
}

/** 鉴权失败 */
export class TTSAuthError extends TTSError {
  constructor(provider: string, message: string, public readonly status?: number) {
    super(message, "auth", provider, false);
    this.name = "TTSAuthError";
  }
}

/** HTTP/传输失败（可重试） */
export class TTSRequestError extends TTSError {
  constructor(provider: string, message: string, public readonly status?: number) {
    super(message, "request", provider, true);
    this.name = "TTSRequestError";
  }
}

/** 响应解析失败 */
export class TTSResponseParseError extends TTSError {
  constructor(provider: string, public readonly bodySnippet: string) {
    super("TTS response is not valid JSON", "response_parse", provider, false);
    this.name = "TTSResponseParseError";
  }
}

/** 服务商业务错误 */
export class TTSServiceError extends TTSError {
  constructor(provider: string, message: string, public readonly serviceCode?: number) {
    super(message, "service", provider, false);
    this.name = "TTSServiceError";
  }
}

/** 返回空音频 */
export class TTSEmptyResultError extends TTSError {
  constructor(provider: string) {
    super("TTS returned empty audio", "empty_result", provider, false);
    this.name = "TTSEmptyResultError";
  }
}
