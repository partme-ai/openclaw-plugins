/**
 * TTS 错误类型
 *
 * 所有 TTS 提供商共用此错误体系。
 * 新增 TTS 提供商时直接 import，无需重复定义。
 */

export type TTSErrorKind = "timeout" | "auth" | "request" | "response_parse" | "service" | "empty_result";

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

export class TTSTimeoutError extends TTSError {
  constructor(provider: string, public readonly timeoutMs: number) {
    super(`TTS request timeout after ${timeoutMs}ms`, "timeout", provider, true);
    this.name = "TTSTimeoutError";
  }
}

export class TTSAuthError extends TTSError {
  constructor(provider: string, message: string, public readonly status?: number) {
    super(message, "auth", provider, false);
    this.name = "TTSAuthError";
  }
}

export class TTSRequestError extends TTSError {
  constructor(provider: string, message: string, public readonly status?: number) {
    super(message, "request", provider, true);
    this.name = "TTSRequestError";
  }
}

export class TTSResponseParseError extends TTSError {
  constructor(provider: string, public readonly bodySnippet: string) {
    super("TTS response is not valid JSON", "response_parse", provider, false);
    this.name = "TTSResponseParseError";
  }
}

export class TTSServiceError extends TTSError {
  constructor(provider: string, message: string, public readonly serviceCode?: number) {
    super(message, "service", provider, false);
    this.name = "TTSServiceError";
  }
}

export class TTSEmptyResultError extends TTSError {
  constructor(provider: string) {
    super("TTS returned empty audio", "empty_result", provider, false);
    this.name = "TTSEmptyResultError";
  }
}
