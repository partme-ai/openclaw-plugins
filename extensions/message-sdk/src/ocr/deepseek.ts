/**
 * @module ocr/deepseek
 *
 * DeepSeek Vision OCR — 基于 DeepSeek 多模态 Chat API 的图片文字识别。
 *
 * **参考**：spring-ai-examples/spring-ai-ollama-ocr-deepseek
 *
 * **关键导出**：`recognizeDeepSeek`
 */

import {
  OCRTimeoutError,
  OCRAuthError,
  OCRRequestError,
  OCRResponseParseError,
  OCRServiceError,
  OCREmptyResultError,
} from "./errors.js";
import type { OCRInput, OCRConfig, OCRResult, OCRBlock } from "./types.js";

const PROVIDER = "deepseek";
const DEFAULT_MODEL = "deepseek-chat";
const DEFAULT_BASE_URL = "https://api.deepseek.com/v1";

function resolveImagePayload(input: OCRInput): { type: string; image_url: { url: string } } {
  if (input.base64) {
    const mime = input.mimeType ?? "image/png";
    return { type: "image_url", image_url: { url: `data:${mime};base64,${input.base64}` } };
  }
  if (input.url) {
    return { type: "image_url", image_url: { url: input.url } };
  }
  throw new OCRRequestError(PROVIDER, "No image data: provide base64 or url");
}

/**
 * 使用 DeepSeek Vision 识别图片中的文字。
 *
 * @param input - 图片 URL 或 base64（见 {@link OCRInput}）
 * @param config - API 密钥与端点
 * @returns 统一 {@link OCRResult} 结构
 * @throws {@link OCRAuthError} {@link OCREmptyResultError} 等
 *
 * @example
 * ```ts
 * const result = await recognizeDeepSeek(
 *   { url: "https://cdn.example.com/doc.png" },
 *   { baseUrl: "https://api.deepseek.com/v1", apiKey: process.env.DEEPSEEK_KEY! },
 * );
 * ```
 */
export async function recognizeDeepSeek(input: OCRInput, config: OCRConfig): Promise<OCRResult> {
  const baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  const model = config.model || DEFAULT_MODEL;
  const timeoutMs = config.timeoutMs ?? 30000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const startMs = Date.now();

  try {
    const imageContent = resolveImagePayload(input);
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "请识别这张图片中的所有文字，逐行输出。不要添加任何解释。" },
            imageContent,
          ],
        }],
        max_tokens: 2000,
        temperature: 0,
      }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      if (resp.status === 401 || resp.status === 403) throw new OCRAuthError(PROVIDER, `DeepSeek auth failed: ${errText}`, resp.status);
      throw new OCRRequestError(PROVIDER, `DeepSeek request failed: HTTP ${resp.status} ${errText}`, resp.status);
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
