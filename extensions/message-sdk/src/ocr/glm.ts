/**
 * @module ocr/glm
 *
 * 智谱 GLM-4V OCR — 基于智谱多模态 Chat API。
 *
 * **参考**：spring-ai-examples/spring-ai-ollama-ocr-glm
 *
 * **关键导出**：`recognizeGLM`
 */

import {
  OCRTimeoutError, OCRAuthError, OCRRequestError, OCRResponseParseError, OCRServiceError, OCREmptyResultError,
} from "./errors.js";
import type { OCRInput, OCRConfig, OCRResult, OCRBlock } from "./types.js";

const PROVIDER = "glm";
const DEFAULT_MODEL = "glm-4v";
const DEFAULT_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";

function resolveImagePayload(input: OCRInput): string {
  if (input.base64) return input.base64;
  if (input.url) {
    // 智谱 Chat API 支持直接传图片 URL
    return input.url;
  }
  throw new OCRRequestError(PROVIDER, "No image data: provide base64 or url");
}

/**
 * 使用智谱 GLM-4V 识别图片中的文字。
 *
 * @param input - 图片 URL 或 base64
 * @param config - API 密钥与端点（默认 open.bigmodel.cn）
 * @returns 统一 OCR 结果
 */
export async function recognizeGLM(input: OCRInput, config: OCRConfig): Promise<OCRResult> {
  const baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  const model = config.model || DEFAULT_MODEL;
  const timeoutMs = config.timeoutMs ?? 30000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const startMs = Date.now();

  try {
    const imagePayload = resolveImagePayload(input);
    const isUrl = /^https?:\/\//i.test(imagePayload);

    const messages = [{
      role: "user" as const,
      content: [
        { type: "text" as const, text: "请识别这张图片中的所有文字，逐行输出。不要添加任何解释。" },
        isUrl
          ? { type: "image_url" as const, image_url: { url: imagePayload } }
          : { type: "image_url" as const, image_url: { url: `data:${input.mimeType ?? "image/png"};base64,${imagePayload}` } },
      ],
    }];

    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model, messages, max_tokens: 2000, temperature: 0 }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      if (resp.status === 401 || resp.status === 403) throw new OCRAuthError(PROVIDER, `GLM auth failed: ${errText}`, resp.status);
      throw new OCRRequestError(PROVIDER, `GLM request failed: HTTP ${resp.status} ${errText}`, resp.status);
    }

    const data = await resp.json().catch(() => { throw new OCRResponseParseError(PROVIDER, "Invalid JSON"); }) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) throw new OCREmptyResultError(PROVIDER);

    const block: OCRBlock = { text, confidence: 0.9, lines: [] };
    return { text, blocks: [block], provider: PROVIDER, model, elapsedMs: Date.now() - startMs };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw new OCRTimeoutError(PROVIDER, timeoutMs);
    throw err;
  } finally { clearTimeout(timeoutId); }
}
