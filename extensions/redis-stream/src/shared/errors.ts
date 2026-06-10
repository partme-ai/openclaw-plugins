/**
 * Typed error classes for Redis Stream operations.
 * All errors extend Error and include structured fields for debugging.
 */

export class RedisConnectionError extends Error {
  readonly url: string;

  constructor(url: string, cause: string) {
    super(`Redis connection failed (${url}): ${cause}`);
    this.name = "RedisConnectionError";
    this.url = url;
  }
}

export class RedisStreamError extends Error {
  readonly stream: string;

  constructor(stream: string, cause: string) {
    super(`Redis stream error (${stream}): ${cause}`);
    this.name = "RedisStreamError";
    this.stream = stream;
  }
}

export class RedisTimeoutError extends Error {
  readonly operation: string;
  readonly timeoutMs: number;

  constructor(operation: string, timeoutMs: number) {
    super(`Redis operation '${operation}' timed out after ${timeoutMs}ms`);
    this.name = "RedisTimeoutError";
    this.operation = operation;
    this.timeoutMs = timeoutMs;
  }
}
