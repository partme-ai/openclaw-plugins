/**
 * PaddleOCR 识别
 *
 * 基于百度 PaddleOCR 的 OCR 识别。
 * PaddleOCR 可通过 PaddleHub Serving 或自部署 HTTP 服务提供 API。
 * 参考：spring-ai-examples/spring-ai-ollama-ocr-paddleocr
 */

import {
  OCRTimeoutError, OCRRequestError, OCRResponseParseError, OCRServiceError, OCREmptyResultError,
} from "./errors.js";
import type { OCRInput, OCRConfig, OCRResult, OCRBlock, OCRLine, OCRWord } from "./types.js";

const PROVIDER = "paddleocr";
const DEFAULT_MODEL = "PP-OCRv4";
const DEFAULT_BASE_URL = "http://localhost:8866/predict/ocr_system";

function resolveImageBase64(input: OCRInput): string {
  if (input.base64) return input.base64;
  throw new OCRRequestError(PROVIDER, "PaddleOCR requires base64 image input");
}

export async function recognizePaddleOCR(input: OCRInput, config: OCRConfig): Promise<OCRResult> {
  const baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  const model = config.model || DEFAULT_MODEL;
  const timeoutMs = config.timeoutMs ?? 30000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const startMs = Date.now();

  try {
    const imageBase64 = resolveImageBase64(input);
    const resp = await fetch(baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ images: [imageBase64] }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      throw new OCRRequestError(PROVIDER, `PaddleOCR request failed: HTTP ${resp.status} ${errText}`, resp.status);
    }

    const data = await resp.json().catch(() => { throw new OCRResponseParseError(PROVIDER, "Invalid JSON"); }) as {
      results?: Array<Array<{
        text: string; confidence: number; text_region?: number[][];
      }>>;
    };

    const results = data?.results?.[0];
    if (!results || results.length === 0) throw new OCREmptyResultError(PROVIDER);

    const blocks: OCRBlock[] = [];
    let fullText = "";
    for (const item of results) {
      const word: OCRWord = { text: item.text, confidence: item.confidence };
      if (item.text_region) {
        const xs = item.text_region.map((p) => p[0]);
        const ys = item.text_region.map((p) => p[1]);
        word.bbox = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      }
      const line: OCRLine = { text: item.text, confidence: item.confidence, words: [word] };
      blocks.push({ text: item.text, confidence: item.confidence, lines: [line] });
      fullText += item.text + "\n";
    }

    return { text: fullText.trim(), blocks, provider: PROVIDER, model, elapsedMs: Date.now() - startMs };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw new OCRTimeoutError(PROVIDER, timeoutMs);
    throw err;
  } finally { clearTimeout(timeoutId); }
}
