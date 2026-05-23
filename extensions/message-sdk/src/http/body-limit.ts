/**
 * Webhook / HTTP 请求体大小限制（对齐 OpenClaw webhook-ingress）。
 */

import type { IncomingMessage } from "node:http";
import { importOpenClawPluginSdk } from "../openclaw/loader.js";

/**
 * DEFAULT_WEBHOOK_MAX_BODY_BYTES 是 http 模块对外共享的常量或默认实现。
 *
 * 修改该值会影响多个通道插件的默认行为，变更前应同步更新相关测试与文档。
 */
export const DEFAULT_WEBHOOK_MAX_BODY_BYTES = 1024 * 1024;
/**
 * DEFAULT_WEBHOOK_BODY_TIMEOUT_MS 是 http 模块对外共享的常量或默认实现。
 *
 * 修改该值会影响多个通道插件的默认行为，变更前应同步更新相关测试与文档。
 */
export const DEFAULT_WEBHOOK_BODY_TIMEOUT_MS = 30_000;

/**
 * RequestBodyLimitErrorCode 是 http 模块的公开类型别名。
 *
 * 该类型用于收窄调用边界，确保不同通道插件复用同一套 SDK 契约。
 */
export type RequestBodyLimitErrorCode =
  | "PAYLOAD_TOO_LARGE"
  | "REQUEST_BODY_TIMEOUT"
  | "CONNECTION_CLOSED";

/**
 * RequestBodyLimitError 表示 http 模块中的可实例化能力。
 *
 * 类实例通常持有内存状态或错误语义；调用方应通过公开方法读取或更新状态，
 * 不要依赖内部字段布局。
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
 * isRequestBodyLimitError 是 http 模块对外暴露的操作入口。
 *
 * 该函数封装本模块的边界逻辑，调用方应优先通过它复用 SDK 内部约定，
 * 避免在具体通道插件中重复实现解析、派发、去重或资源处理细节。
 * @param params - 调用该操作所需的输入；字段含义以同文件或相邻 types 文件中的类型定义为准。
 * @returns 返回标准化结果；异步函数会在底层 I/O、网络或 Runtime 调用失败时抛出对应错误。
 */
export function isRequestBodyLimitError(
  error: unknown,
  code?: RequestBodyLimitErrorCode,
): error is RequestBodyLimitError {
  if (!(error instanceof RequestBodyLimitError)) return false;
  return !code || error.code === code;
}

/**
 * ReadRequestBodyOptions 是 http 模块的公开类型别名。
 *
 * 该类型用于收窄调用边界，确保不同通道插件复用同一套 SDK 契约。
 */
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
