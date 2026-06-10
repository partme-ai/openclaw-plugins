/**
 * @file Gotify 插件可恢复错误类型集合。
 *
 * @description 所有可分类网络 / 配置 / 协议异常均派生自 `Error` 并附加只读结构化字段，
 * 方便上层 (`channel.ts` / HTTP handler / CLI) 做**精确分支**或 operator 聚合展示。
 * **不覆盖**泛型 SDK 异常，仅封装 Gotify 特化语义。
 */

/**
 * Gotify REST 返回非成功 HTTP 状态时的强类型异常。
 *
 * @description 携带 `statusCode`，用于区分 401/403/5xx 等，且 message 包含响应体摘要。
 * @extends Error
 */
export class GotifyApiError extends Error {
  readonly statusCode: number;

  /**
   * @param message - 人可读错误文本，通常包含 Gotify 端返回 JSON / 文本摘要。
   * @param statusCode - 原始 HTTP 响应状态码。
   */
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "GotifyApiError";
    this.statusCode = statusCode;
  }
}

/**
 * 网络层不可达、DNS、`fetch` 抛出或重试耗尽后的兜底异常。
 *
 * @description **非 HTTP 语义**，表示链路问题；消息前缀固定便于日志 grep。
 */
export class GotifyConnectionError extends Error {
  readonly cause: string;

  /**
   * @param cause - 底层网络错误、DNS 错误或 fetch 错误的可读描述。
   */
  constructor(cause: string) {
    super(`Gotify connection failed: ${cause}`);
    this.name = "GotifyConnectionError";
    this.cause = cause;
  }
}

/**
 * operator 填写缺失字段或非法依赖组合（例如缺少必要 token）。
 *
 * @description `field` 指明配置键，`message`（继承自 Error.message）拼接 human reason。
 */
export class GotifyConfigError extends Error {
  readonly field: string;

  /**
   * @param field - 缺失或无效的配置字段名。
   * @param reason - 面向 operator 的配置错误原因。
   */
  constructor(field: string, reason: string) {
    super(`Gotify configuration error: ${field} - ${reason}`);
    this.name = "GotifyConfigError";
    this.field = field;
  }
}

/**
 * WebSocket `/stream` 建连失败、超时、被动关闭或被本地 `stop()` 中断时的封装。
 *
 * @description `code` 字段用于上层 metrics / UI 归类（非 wire close code）。
 */
export class GotifyWebSocketError extends Error {
  readonly cause: string;
  readonly code?: string;

  /**
   * @param cause - WebSocket 断开、连接失败或协议错误的可读描述。
   * @param code - 插件内部错误分类，用于状态上报和测试断言。
   */
  constructor(cause: string, code?: string) {
    super(`Gotify WebSocket error: ${cause}${code ? ` (code: ${code})` : ""}`);
    this.name = "GotifyWebSocketError";
    this.cause = cause;
    this.code = code;
  }
}

/**
 * REST / WS 单次操作超过允许的最大等待时长。
 *
 * @description `timeoutMs` 与实际 `AbortController` 阈值一致。
 */
export class GotifyTimeoutError extends Error {
  readonly timeoutMs: number;

  /**
   * @param timeoutMs - 本次操作允许的最大等待时间，单位毫秒。
   * @param operation - 超时的操作名称，例如 `fetch request`。
   */
  constructor(timeoutMs: number, operation: string) {
    super(`Gotify timeout: ${operation} exceeded ${timeoutMs}ms`);
    this.name = "GotifyTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}
