/**
 * OCR provider 协议与输入边界测试。
 *
 * 使用本地 Response mock 固定 GLM 多模态消息和 PaddleOCR 结构化结果，不把“能编译”误当成
 * “协议可用”；同时验证凭据、URL、base64 大小和超时在网络调用前失败。
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { OCRAuthError, OCREmptyResultError, OCRRequestError, OCRTimeoutError } from "./errors.js";
import { recognizeGLM } from "./glm.js";
import { recognizePaddleOCR } from "./paddleocr.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("OCR providers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends the official GLM image_url content shape and returns normalized text", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      choices: [{ message: { content: "  发票号码 123  " } }],
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await recognizeGLM(
      { url: "https://cdn.example.test/invoice.png" },
      { baseUrl: "https://open.bigmodel.cn/api/paas/v4", apiKey: "zhipu-key" },
    );

    expect(result).toMatchObject({ text: "发票号码 123", provider: "glm", model: "glm-4.5v" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://open.bigmodel.cn/api/paas/v4/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer zhipu-key");
    const body = JSON.parse(String(init.body)) as { model: string; messages: Array<{ content: unknown[] }> };
    expect(body.model).toBe("glm-4.5v");
    expect(body.messages[0]?.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "image_url", image_url: { url: "https://cdn.example.test/invoice.png" } }),
    ]));
  });

  it("builds a bounded data URL for GLM base64 input", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ choices: [{ message: { content: "ok" } }] }));
    vi.stubGlobal("fetch", fetchMock);
    await recognizeGLM(
      { base64: Buffer.from("img").toString("base64"), mimeType: "image/jpeg" },
      { baseUrl: "https://open.bigmodel.cn/api/paas/v4", apiKey: "key", maxImageBytes: 3 },
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(String(init.body)).toContain("data:image/jpeg;base64,aW1n");
  });

  it("fails GLM before fetch for missing credentials, unsafe URL and oversized base64", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(recognizeGLM(
      { url: "https://cdn.example.test/a.png" },
      { baseUrl: "https://open.bigmodel.cn/api/paas/v4", apiKey: "" },
    )).rejects.toBeInstanceOf(OCRAuthError);
    await expect(recognizeGLM(
      { url: "file:///etc/passwd" },
      { baseUrl: "https://open.bigmodel.cn/api/paas/v4", apiKey: "key" },
    )).rejects.toBeInstanceOf(OCRRequestError);
    await expect(recognizeGLM(
      { base64: Buffer.from("too-large").toString("base64") },
      { baseUrl: "https://open.bigmodel.cn/api/paas/v4", apiKey: "key", maxImageBytes: 2 },
    )).rejects.toThrow(/maxImageBytes/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("classifies GLM auth, empty result and abort responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "unauthorized" }, 401)));
    await expect(recognizeGLM(
      { url: "https://cdn.example.test/a.png" },
      { baseUrl: "https://open.bigmodel.cn/api/paas/v4", apiKey: "bad" },
    )).rejects.toBeInstanceOf(OCRAuthError);

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ choices: [] })));
    await expect(recognizeGLM(
      { url: "https://cdn.example.test/a.png" },
      { baseUrl: "https://open.bigmodel.cn/api/paas/v4", apiKey: "key" },
    )).rejects.toBeInstanceOf(OCREmptyResultError);

    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("aborted", "AbortError"); }));
    await expect(recognizeGLM(
      { url: "https://cdn.example.test/a.png" },
      { baseUrl: "https://open.bigmodel.cn/api/paas/v4", apiKey: "key", timeoutMs: 10 },
    )).rejects.toBeInstanceOf(OCRTimeoutError);
  });

  it("maps PaddleOCR results into blocks, lines, words and bounding boxes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      results: [[
        { text: "第一行", confidence: 0.98, text_region: [[1, 2], [11, 2], [11, 8], [1, 8]] },
        { text: "第二行", confidence: 0.95 },
      ]],
    })));
    const result = await recognizePaddleOCR(
      { base64: Buffer.from("image").toString("base64") },
      { baseUrl: "http://127.0.0.1:8866/predict/ocr_system", apiKey: "" },
    );
    expect(result.text).toBe("第一行\n第二行");
    expect(result.blocks[0]?.lines[0]?.words[0]?.bbox).toEqual([1, 2, 11, 8]);
    expect(result).toMatchObject({ provider: "paddleocr", model: "PP-OCRv4" });
  });

  it("rejects invalid PaddleOCR input and empty provider results", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ results: [[]] }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(recognizePaddleOCR(
      { url: "https://cdn.example.test/a.png" },
      { baseUrl: "http://127.0.0.1:8866/predict/ocr_system", apiKey: "" },
    )).rejects.toBeInstanceOf(OCRRequestError);
    await expect(recognizePaddleOCR(
      { base64: Buffer.from("image").toString("base64") },
      { baseUrl: "http://127.0.0.1:8866/predict/ocr_system", apiKey: "" },
    )).rejects.toBeInstanceOf(OCREmptyResultError);
  });
});
