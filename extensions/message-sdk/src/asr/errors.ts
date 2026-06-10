/**
 * @module asr/errors
 *
 * ASR 错误类型 — 所有 ASR 提供商（腾讯云、百度、阿里云等）共用。
 *
 * **关键导出**：`ASRError` 及子类、`ASRErrorKind`
 */

/** ASR 错误种类 / ASR error classification */
export type ASRErrorKind = "timeout" | "auth" | "request" | "response_parse" | "service" | "empty_result";

/**
 * ASR 基础错误 / Base error for all ASR providers.
 *
 * @property kind - 错误分类
 * @property provider - 提供商标识（如 `tencent-flash`）
 * @property retryable - 是否建议重试
 */
export class ASRError extends Error {
  constructor(
    message: string,
    public readonly kind: ASRErrorKind,
    public readonly provider: string,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = "ASRError";
  }
}

/** 请求超时（可重试）/ Request timed out */
export class ASRTimeoutError extends ASRError {
  constructor(provider: string, public readonly timeoutMs: number) {
    super(`ASR request timeout after ${timeoutMs}ms`, "timeout", provider, true);
    this.name = "ASRTimeoutError";
  }
}

/** 鉴权失败（不可重试）/ Authentication failed */
export class ASRAuthError extends ASRError {
  constructor(provider: string, message: string, public readonly status?: number) {
    super(message, "auth", provider, false);
    this.name = "ASRAuthError";
  }
}

/** HTTP/传输层请求失败（可重试）/ Transport or HTTP failure */
export class ASRRequestError extends ASRError {
  constructor(provider: string, message: string, public readonly status?: number) {
    super(message, "request", provider, true);
    this.name = "ASRRequestError";
  }
}

/** 响应非合法 JSON / Response body is not valid JSON */
export class ASRResponseParseError extends ASRError {
  constructor(provider: string, public readonly bodySnippet: string) {
    super("ASR response is not valid JSON", "response_parse", provider, false);
    this.name = "ASRResponseParseError";
  }
}

/** 服务商返回业务错误码 / Provider service-level error */
export class ASRServiceError extends ASRError {
  constructor(provider: string, message: string, public readonly serviceCode?: number) {
    super(message, "service", provider, false);
    this.name = "ASRServiceError";
  }
}

/** 识别结果为空 / Empty transcript */
export class ASREmptyResultError extends ASRError {
  constructor(provider: string) {
    super("ASR returned empty transcript", "empty_result", provider, false);
    this.name = "ASREmptyResultError";
  }
}
