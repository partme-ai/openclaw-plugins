/**
 * Webhook / HTTP 请求体大小限制（对齐 OpenClaw webhook-ingress）。
 */

import type { IncomingMessage } from "node:http";
import { importOpenClawPluginSdk } from "../openclaw-loader.js";

export const DEFAULT_WEBHOOK_MAX_BODY_BYTES = 1024 * 1024;
export const DEFAULT_WEBHOOK_BODY_TIMEOUT_MS = 30_000;

export type RequestBodyLimitErrorCode =
  | "PAYLOAD_TOO_LARGE"
  | "REQUEST_BODY_TIMEOUT"
  | "CONNECTION_CLOSED";

export class RequestBodyLimitError extends Error {
  readonly code: RequestBodyLimitErrorCode;
  readonly statusCode: number;

  constructor(code: RequestBodyLimitErrorCode, message?: string) {
    const statusByCode: Record<RequestBodyLimitErrorCode, number> = {
      PAYLOAD_TOO_LARGE: 413,
      REQUEST_BODY_TIMEOUT: 408,
      CONNECTION_CLOSED: 400,
    };
    super(message ?? code);
    this.name = "RequestBodyLimitError";
    this.code = code;
    this.statusCode = statusByCode[code];
  }
}

export function isRequestBodyLimitError(
  error: unknown,
  code?: RequestBodyLimitErrorCode,
): error is RequestBodyLimitError {
  if (!(error instanceof RequestBodyLimitError)) return false;
  return !code || error.code === code;
}

export type ReadRequestBodyOptions = {
  maxBytes?: number;
  timeoutMs?: number;
  encoding?: BufferEncoding;
};

/**
 * 读取 IncomingMessage body（带大小与超时限制）。
 */
export async function readRequestBodyWithLimit(
  req: IncomingMessage,
  options: ReadRequestBodyOptions = {},
): Promise<string> {
  const sdk = await importOpenClawPluginSdk<{
    readRequestBodyWithLimit?: (r: IncomingMessage, o: ReadRequestBodyOptions) => Promise<string>;
    isRequestBodyLimitError?: typeof isRequestBodyLimitError;
  }>("webhook-request-guards");

  if (typeof sdk?.readRequestBodyWithLimit === "function") {
    return sdk.readRequestBodyWithLimit(req, options);
  }

  const maxBytes = Math.max(
    1,
    Math.floor(options.maxBytes ?? DEFAULT_WEBHOOK_MAX_BODY_BYTES),
  );
  const timeoutMs = Math.max(
    1,
    Math.floor(options.timeoutMs ?? DEFAULT_WEBHOOK_BODY_TIMEOUT_MS),
  );
  const encoding = options.encoding ?? "utf8";

  const contentLength = parseContentLength(req);
  if (contentLength != null && contentLength > maxBytes) {
    req.destroy?.();
    throw new RequestBodyLimitError("PAYLOAD_TOO_LARGE");
  }

  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      req.destroy?.();
      reject(new RequestBodyLimitError("REQUEST_BODY_TIMEOUT"));
    }, timeoutMs);

    const finish = (err?: Error, value?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(value ?? "");
    };

    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        finish(new RequestBodyLimitError("PAYLOAD_TOO_LARGE"));
        req.destroy?.();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      finish(undefined, Buffer.concat(chunks).toString(encoding));
    });
    req.on("error", () => {
      finish(new RequestBodyLimitError("CONNECTION_CLOSED"));
    });
    req.on("aborted", () => {
      finish(new RequestBodyLimitError("CONNECTION_CLOSED"));
    });
  });
}

function parseContentLength(req: IncomingMessage): number | null {
  const header = req.headers["content-length"];
  const raw = Array.isArray(header) ? header[0] : header;
  if (typeof raw !== "string") return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
