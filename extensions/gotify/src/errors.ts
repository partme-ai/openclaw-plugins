/**
 * Typed error classes for Gotify plugin.
 *
 * Following the plugin specification pattern, all errors extend Error
 * and include structured fields for programmatic handling.
 */

/**
 * Gotify API error with HTTP status code.
 * Thrown when Gotify API returns an error response.
 */
export class GotifyApiError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'GotifyApiError';
    this.statusCode = statusCode;
  }
}

/**
 * Gotify connection error.
 * Thrown when network connection to Gotify server fails.
 */
export class GotifyConnectionError extends Error {
  readonly cause: string;

  constructor(cause: string) {
    super(`Gotify connection failed: ${cause}`);
    this.name = 'GotifyConnectionError';
    this.cause = cause;
  }
}

/**
 * Gotify configuration error.
 * Thrown when required configuration is missing or invalid.
 */
export class GotifyConfigError extends Error {
  readonly field: string;

  constructor(field: string, reason: string) {
    super(`Gotify configuration error: ${field} - ${reason}`);
    this.name = 'GotifyConfigError';
    this.field = field;
  }
}

/**
 * Gotify WebSocket error.
 * Thrown when WebSocket connection fails or encounters an error.
 */
export class GotifyWebSocketError extends Error {
  readonly cause: string;
  readonly code?: string;

  constructor(cause: string, code?: string) {
    super(`Gotify WebSocket error: ${cause}${code ? ` (code: ${code})` : ''}`);
    this.name = 'GotifyWebSocketError';
    this.cause = cause;
    this.code = code;
  }
}

/**
 * Gotify timeout error.
 * Thrown when an API request exceeds the configured timeout.
 */
export class GotifyTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number, operation: string) {
    super(`Gotify timeout: ${operation} exceeded ${timeoutMs}ms`);
    this.name = 'GotifyTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}
