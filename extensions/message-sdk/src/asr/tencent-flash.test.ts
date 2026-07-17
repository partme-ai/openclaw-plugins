/**
 * 腾讯云 Flash ASR 协议契约测试。
 *
 * 不访问真实腾讯云；通过独立 mock 响应锁定签名请求形态、错误分类、结果拼接和超时语义，
 * 避免消费者把认证失败或业务错误错误地当成可无限重试的网络故障。
 */

import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ASRAuthError,
  ASREmptyResultError,
  ASRRequestError,
  ASRResponseParseError,
  ASRServiceError,
  ASRTimeoutError,
} from "./errors.js";
import { transcribeTencentFlash } from "./tencent-flash.js";

const config = {
  appId: "app-123",
  secretId: "secret-id",
  secretKey: "secret-key",
  engineType: "16k_zh",
  voiceFormat: "silk",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("transcribeTencentFlash", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("signs the canonical request and joins item/sentence transcripts", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const fetchMock = vi.fn(async () => jsonResponse({
      code: 0,
      flash_result: [
        { text: " 第一段 " },
        { sentence_list: [{ text: "第二段" }, { text: " " }] },
      ],
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(transcribeTencentFlash({ audio: Buffer.from("audio"), config }))
      .resolves.toBe("第一段\n第二段");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://asr.cloud.tencent.com");
    expect(parsed.pathname).toBe("/asr/flash/v1/app-123");
    expect(parsed.searchParams.get("timestamp")).toBe("1700000000");
    expect(parsed.searchParams.get("secretid")).toBe("secret-id");
    const canonicalQuery = [...parsed.searchParams.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join("&");
    const expected = createHmac("sha1", config.secretKey)
      .update(`POSTasr.cloud.tencent.com/asr/flash/v1/app-123?${canonicalQuery}`)
      .digest("base64");
    expect((init.headers as Record<string, string>).Authorization).toBe(expected);
    expect(init.body).toEqual(Buffer.from("audio"));
  });

  it("classifies HTTP authentication failures as non-retryable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ message: "invalid signature" }, 401)));
    await expect(transcribeTencentFlash({ audio: Buffer.from("a"), config }))
      .rejects.toMatchObject({ name: "ASRAuthError", retryable: false, status: 401 });
  });

  it("classifies non-auth HTTP failures as retryable request errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ message: "busy" }, 503)));
    await expect(transcribeTencentFlash({ audio: Buffer.from("a"), config }))
      .rejects.toMatchObject({ name: "ASRRequestError", retryable: true, status: 503 });
  });

  it("preserves provider business errors and invalid JSON separately", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ code: 4006, message: "bad audio" })));
    await expect(transcribeTencentFlash({ audio: Buffer.from("a"), config }))
      .rejects.toBeInstanceOf(ASRServiceError);

    vi.stubGlobal("fetch", vi.fn(async () => new Response("not-json", { status: 200 })));
    await expect(transcribeTencentFlash({ audio: Buffer.from("a"), config }))
      .rejects.toBeInstanceOf(ASRResponseParseError);
  });

  it("rejects an empty successful transcript", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ code: 0, flash_result: [] })));
    await expect(transcribeTencentFlash({ audio: Buffer.from("a"), config }))
      .rejects.toBeInstanceOf(ASREmptyResultError);
  });

  it("maps AbortError to ASRTimeoutError and other transport errors to ASRRequestError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new DOMException("aborted", "AbortError");
    }));
    await expect(transcribeTencentFlash({ audio: Buffer.from("a"), config: { ...config, timeoutMs: 10 } }))
      .rejects.toBeInstanceOf(ASRTimeoutError);

    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("socket reset");
    }));
    await expect(transcribeTencentFlash({ audio: Buffer.from("a"), config }))
      .rejects.toBeInstanceOf(ASRRequestError);
  });

  it("fails fast for missing credentials, empty audio and invalid timeout", async () => {
    await expect(transcribeTencentFlash({ audio: Buffer.from("a"), config: { ...config, secretKey: "" } }))
      .rejects.toBeInstanceOf(ASRAuthError);
    await expect(transcribeTencentFlash({ audio: Buffer.alloc(0), config }))
      .rejects.toThrow(/non-empty Buffer/);
    await expect(transcribeTencentFlash({ audio: Buffer.from("a"), config: { ...config, timeoutMs: 0 } }))
      .rejects.toThrow(RangeError);
  });
});
