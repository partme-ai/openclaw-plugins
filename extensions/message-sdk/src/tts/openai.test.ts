/**
 * OpenAI `/audio/speech` 契约测试。
 *
 * 锁定当前模型无关的 API 形态、内置语音/格式/speed 校验、4096 字符硬上限，以及响应音频
 * 流式大小保护。所有响应均为本地 mock，不消耗真实 API 配额。
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { TTSAuthError, TTSEmptyResultError, TTSRequestError, TTSTimeoutError } from "./errors.js";
import { synthesizeOpenAI } from "./openai.js";

function audioResponse(chunks: string[], headers?: Record<string, string>): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }), { status: 200, headers });
}

describe("synthesizeOpenAI", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends a current voice, format and bounded speed to /audio/speech", async () => {
    const fetchMock = vi.fn(async () => audioResponse(["audio"]));
    vi.stubGlobal("fetch", fetchMock);
    const result = await synthesizeOpenAI("你好", {
      apiKey: "openai-key",
      model: "gpt-4o-mini-tts",
      voice: "coral",
      outputFormat: "wav",
      rate: "+25%",
    });
    expect(result).toMatchObject({ provider: "openai", voice: "coral", format: "wav" });
    expect(result.audio.toString()).toBe("audio");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/audio/speech");
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: "gpt-4o-mini-tts", input: "你好", voice: "coral", response_format: "wav", speed: 1.25,
    });
  });

  it("rejects unsupported voice/format/rate instead of silently changing the request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(synthesizeOpenAI("text", { apiKey: "key", voice: "unknown" }))
      .rejects.toBeInstanceOf(TTSRequestError);
    await expect(synthesizeOpenAI("text", { apiKey: "key", outputFormat: "ogg" }))
      .rejects.toThrow(/response format/);
    await expect(synthesizeOpenAI("text", { apiKey: "key", rate: "-100%" }))
      .rejects.toThrow(/between 0.25 and 4.0/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails fast for empty text, missing key, invalid limits and the official 4096 limit", async () => {
    await expect(synthesizeOpenAI(" ", { apiKey: "key" })).rejects.toBeInstanceOf(TTSRequestError);
    await expect(synthesizeOpenAI("text", { apiKey: "" })).rejects.toBeInstanceOf(TTSAuthError);
    await expect(synthesizeOpenAI("text", { apiKey: "key", timeoutMs: 0 })).rejects.toThrow(RangeError);
    await expect(synthesizeOpenAI("x".repeat(4097), { apiKey: "key", maxTextLength: 10_000 }))
      .rejects.toThrow(/Text too long/);
  });

  it("cancels streamed audio when maxAudioBytes is exceeded", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => audioResponse(["1234", "5678"])));
    await expect(synthesizeOpenAI("text", { apiKey: "key", maxAudioBytes: 5 }))
      .rejects.toThrow(/maxAudioBytes=5/);
  });

  it("classifies auth, empty and abort responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("denied", { status: 401 })));
    await expect(synthesizeOpenAI("text", { apiKey: "bad" })).rejects.toBeInstanceOf(TTSAuthError);

    vi.stubGlobal("fetch", vi.fn(async () => audioResponse([])));
    await expect(synthesizeOpenAI("text", { apiKey: "key" })).rejects.toBeInstanceOf(TTSEmptyResultError);

    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("aborted", "AbortError"); }));
    await expect(synthesizeOpenAI("text", { apiKey: "key", timeoutMs: 10 }))
      .rejects.toBeInstanceOf(TTSTimeoutError);
  });
});
