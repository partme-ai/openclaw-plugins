/**
 * @module media/http-media
 *
 * 企业微信所有远程媒体下载的统一安全边界。
 *
 * **职责**：通过 OpenClaw SSRF Guard 建立连接，并在读取响应流时实施真实字节上限；不能只信任
 * `Content-Length`，因为服务端可以省略或伪造该头。Bot/Agent 出站共用本模块，避免一条路径安全、
 * 另一条路径仍用无界 `arrayBuffer()`。
 */

import { fetchWithSsrFGuard } from "../runtime/runtime-api.js";

export type GuardedHttpMedia = {
  buffer: Buffer;
  contentType: string;
};

/** 在固定字节预算内读取 Fetch Response，超限时立即取消底层流。 */
export async function readResponseBodyBounded(
  response: Response,
  maxBytes: number,
): Promise<Buffer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("media maxBytes must be a positive safe integer");
  }
  const contentLength = response.headers.get("content-length");
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > maxBytes) {
    throw new Error(`media exceeds configured limit (${maxBytes} bytes)`);
  }
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`media exceeds configured limit (${maxBytes} bytes)`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

/** 使用 SSRF Guard 下载远程媒体，并保证 release 在所有成功/失败分支执行。 */
export async function downloadGuardedHttpMedia(params: {
  url: string;
  maxBytes: number;
  timeoutMs?: number;
}): Promise<GuardedHttpMedia> {
  const { response, release } = await fetchWithSsrFGuard({
    url: params.url,
    timeoutMs: params.timeoutMs ?? 30_000,
  });
  try {
    if (!response.ok) throw new Error(`media download failed: HTTP ${response.status}`);
    return {
      buffer: await readResponseBodyBounded(response, params.maxBytes),
      contentType: response.headers.get("content-type") ?? "",
    };
  } finally {
    await release();
  }
}
