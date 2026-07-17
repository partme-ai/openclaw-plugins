/**
 * @fileoverview Redis Stream 传输层的结构化错误类型。
 *
 * 连接、Stream 命令和超时分别使用独立错误类型，上层可以在不解析 message 文本的情况下
 * 决定健康状态、重试策略和诊断输出。错误对象只保存脱敏后的端点或操作名，禁止携带密码和
 * 原始消息正文。
 */

export class RedisConnectionError extends Error {
  /** 已脱敏的 Redis 端点；由调用方负责在构造前移除凭据。 */
  readonly url: string;

  constructor(url: string, cause: string) {
    const safeUrl = redactRedisUrl(url);
    super(`Redis connection failed (${safeUrl}): ${cause}`);
    this.name = "RedisConnectionError";
    this.url = safeUrl;
  }
}

/** 在错误构造边界再次脱敏，避免调用方遗漏处理时把 Redis ACL 凭据写入日志。 */
function redactRedisUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.username) url.username = "***";
    if (url.password) url.password = "***";
    return url.toString();
  } catch {
    return value ? "<invalid-redis-url>" : "<uninitialized>";
  }
}

export class RedisStreamError extends Error {
  /** 发生 XGROUP/XREADGROUP 等错误的 Stream key。 */
  readonly stream: string;

  constructor(stream: string, cause: string) {
    super(`Redis stream error (${stream}): ${cause}`);
    this.name = "RedisStreamError";
    this.stream = stream;
  }
}

export class RedisTimeoutError extends Error {
  /** 超时的逻辑操作名，例如 Redis startup connection 或 XREADGROUP。 */
  readonly operation: string;
  readonly timeoutMs: number;

  constructor(operation: string, timeoutMs: number) {
    super(`Redis operation '${operation}' timed out after ${timeoutMs}ms`);
    this.name = "RedisTimeoutError";
    this.operation = operation;
    this.timeoutMs = timeoutMs;
  }
}
