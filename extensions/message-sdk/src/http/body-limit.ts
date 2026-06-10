/**
 * @module http/body-limit
 *
 * Webhook / HTTP 请求体大小限制（对齐 OpenClaw webhook-ingress）。
 *
 * **职责**：读取 `IncomingMessage` body 时限制体积与等待时间，防止大 payload 拖垮进程。
 *
 * **关键导出**：`readRequestBodyWithLimit`、`RequestBodyLimitError`、`isRequestBodyLimitError`
 */

import type { IncomingMessage } from "node:http";
import { importOpenClawPluginSdk } from "../openclaw/loader.js";

/** Webhook 默认最大 body 字节数（1 MiB）/ Default max webhook body size */
export const DEFAULT_WEBHOOK_MAX_BODY_BYTES = 1024 * 1024;

/** Webhook 默认 body 读取超时（毫秒）/ Default body read timeout */
export const DEFAULT_WEBHOOK_BODY_TIMEOUT_MS = 30_000;

/** 请求体限制错误码 / Request body limit error codes */
export type RequestBodyLimitErrorCode =
  | "PAYLOAD_TOO_LARGE"
  | "REQUEST_BODY_TIMEOUT"
  | "CONNECTION_CLOSED";

/**
 * 请求体读取失败（过大、超时或连接中断）。
 *
 * @property code - 错误种类
 * @property statusCode - 建议返回的 HTTP 状态码（413/408/400）
 */
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

/**
 * 类型守卫：判断是否为 {@link RequestBodyLimitError}。
 *
 * @param error - 待检测错误
 * @param code - 可选：进一步匹配具体 code
 * @returns 是否为（可选匹配 code 的）RequestBodyLimitError
 */
export function isRequestBodyLimitError(
  error: unknown,
  code?: RequestBodyLimitErrorCode,
): error is RequestBodyLimitError {
  if (!(error instanceof RequestBodyLimitError)) return false;
  return !code || error.code === code;
}

/**
 * 读取请求体选项 / Options for reading request body with limits.
 *
 * @property maxBytes - 最大字节数（默认 {@link DEFAULT_WEBHOOK_MAX_BODY_BYTES}）
 * @property timeoutMs - 读取超时（默认 {@link DEFAULT_WEBHOOK_BODY_TIMEOUT_MS}）
 * @property encoding - 输出字符串编码（默认 `utf8`）
 */
export type ReadRequestBodyOptions = {
  maxBytes?: number;
  timeoutMs?: number;
  encoding?: BufferEncoding;
};

/**
 * 读取 IncomingMessage body（带大小与超时限制）。
 *
 * 优先委托 OpenClaw `webhook-request-guards` SDK；不可用时使用本地 stream 实现。
 *
 * @param req - Node.js HTTP 入站请求
 * @param options - 大小、超时与编码
 * @returns 解码后的 body 字符串
 * @throws {@link RequestBodyLimitError} 超限、超时或连接异常
 *
 * @example
 * ```ts
 * const raw = await readRequestBodyWithLimit(req, { maxBytes: 512 * 1024 });
 * const payload = JSON.parse(raw);
 * ```
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

  // 提前拒绝 Content-Length 已超限的请求
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

/** 解析 Content-Length 头；无效时返回 null */
function parseContentLength(req: IncomingMessage): number | null {
  const header = req.headers["content-length"];
  const raw = Array.isArray(header) ? header[0] : header;
  if (typeof raw !== "string") return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
