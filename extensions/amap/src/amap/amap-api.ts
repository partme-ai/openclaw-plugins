import type { AmapApiResponse, AmapPluginConfig } from "../types.js";

const ALLOWED_PATHS = new Set(["/v5/place/text", "/v5/place/around", "/v5/place/detail"]);

export class AmapApiError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = "AmapApiError";
  }
}

export class AmapClient {
  private readonly requestTimestamps: number[] = [];

  constructor(private readonly config: AmapPluginConfig) {}

  async get(path: string, params: Record<string, string | number | undefined>): Promise<AmapApiResponse> {
    if (!ALLOWED_PATHS.has(path)) throw new AmapApiError("Unsupported AMap API path");
    this.consumeRateLimit();
    const url = new URL(path, `${this.config.apiBaseUrl}/`);
    url.searchParams.set("key", this.config.key);
    url.searchParams.set("output", "JSON");
    for (const [name, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(name, String(value));
    }

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.config.retryAttempts; attempt += 1) {
      try {
        const response = await fetch(url, {
          method: "GET",
          headers: { Accept: "application/json", "User-Agent": "openclaw-amap/2026.7.1" },
          signal: AbortSignal.timeout(this.config.requestTimeoutMs),
        });
        const body = await readBoundedBody(response, this.config.maxResponseBytes);
        if ((response.status === 429 || response.status >= 500) && attempt < this.config.retryAttempts) {
          await delay(Math.min(250 * 2 ** attempt, 1_000));
          continue;
        }
        if (!response.ok) throw new AmapApiError(`AMap API HTTP ${response.status}`);
        let parsed: AmapApiResponse;
        try {
          parsed = JSON.parse(body) as AmapApiResponse;
        } catch {
          throw new AmapApiError("AMap API returned invalid JSON");
        }
        if (String(parsed.status ?? "1") !== "1") {
          throw new AmapApiError(`AMap API rejected the request: ${String(parsed.info ?? "unknown error")}`, String(parsed.infocode ?? ""));
        }
        return parsed;
      } catch (error) {
        lastError = error;
        const retryable = error instanceof TypeError || (error instanceof DOMException && error.name === "TimeoutError");
        if (!retryable || attempt >= this.config.retryAttempts) break;
        await delay(Math.min(250 * 2 ** attempt, 1_000));
      }
    }
    if (lastError instanceof AmapApiError) throw lastError;
    if (lastError instanceof DOMException && lastError.name === "TimeoutError") throw new AmapApiError("AMap API request timed out");
    throw new AmapApiError(`AMap API request failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }

  private consumeRateLimit(now = Date.now()): void {
    const cutoff = now - 60_000;
    while (this.requestTimestamps[0] !== undefined && this.requestTimestamps[0] <= cutoff) this.requestTimestamps.shift();
    if (this.requestTimestamps.length >= this.config.maxRequestsPerMinute) throw new AmapApiError("AMap local request rate limit exceeded");
    this.requestTimestamps.push(now);
  }
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<string> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) throw new AmapApiError("AMap API response exceeded maxResponseBytes");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new AmapApiError("AMap API response exceeded maxResponseBytes");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}
