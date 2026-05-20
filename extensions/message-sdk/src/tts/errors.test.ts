/**
 * TTS 错误类 单元测试
 */
import { describe, it, expect } from "vitest";
import {
  TTSError,
  TTSTimeoutError,
  TTSAuthError,
  TTSRequestError,
  TTSResponseParseError,
  TTSServiceError,
  TTSEmptyResultError,
} from "./errors.ts";

describe("TTSError", () => {
  it("基类携带 kind/provider/retryable", () => {
    const err = new TTSError("test", "service", "openai", true);
    expect(err.name).toBe("TTSError");
    expect(err.kind).toBe("service");
    expect(err.provider).toBe("openai");
    expect(err.retryable).toBe(true);
    expect(err.message).toBe("test");
  });

  it("默认不可重试", () => {
    const err = new TTSError("err", "auth", "edge");
    expect(err.retryable).toBe(false);
  });
});

describe("TTSTimeoutError", () => {
  it("可重试", () => {
    const err = new TTSTimeoutError("openai", 20000);
    expect(err.kind).toBe("timeout");
    expect(err.retryable).toBe(true);
    expect(err.timeoutMs).toBe(20000);
  });
});

describe("TTSAuthError", () => {
  it("不可重试", () => {
    const err = new TTSAuthError("edge", "Invalid token", 401);
    expect(err.kind).toBe("auth");
    expect(err.retryable).toBe(false);
    expect(err.status).toBe(401);
  });
});

describe("TTSRequestError", () => {
  it("可重试", () => {
    const err = new TTSRequestError("openai", "Gateway timeout", 504);
    expect(err.kind).toBe("request");
    expect(err.retryable).toBe(true);
  });
});

describe("TTSResponseParseError", () => {
  it("不可重试", () => {
    const err = new TTSResponseParseError("edge", "not json");
    expect(err.kind).toBe("response_parse");
    expect(err.retryable).toBe(false);
    expect(err.bodySnippet).toBe("not json");
  });
});

describe("TTSServiceError", () => {
  it("不可重试", () => {
    const err = new TTSServiceError("openai", "quota exceeded", 429);
    expect(err.kind).toBe("service");
    expect(err.retryable).toBe(false);
  });
});

describe("TTSEmptyResultError", () => {
  it("不可重试", () => {
    const err = new TTSEmptyResultError("edge");
    expect(err.kind).toBe("empty_result");
    expect(err.retryable).toBe(false);
    expect(err.message).toContain("empty audio");
  });
});

describe("TTS 错误继承链", () => {
  it("所有子类都是 TTSError 的实例", () => {
    expect(new TTSTimeoutError("t", 1000)).toBeInstanceOf(TTSError);
    expect(new TTSAuthError("t", "m")).toBeInstanceOf(TTSError);
    expect(new TTSRequestError("t", "m")).toBeInstanceOf(TTSError);
    expect(new TTSResponseParseError("t", "b")).toBeInstanceOf(TTSError);
    expect(new TTSServiceError("t", "m")).toBeInstanceOf(TTSError);
    expect(new TTSEmptyResultError("t")).toBeInstanceOf(TTSError);
  });
});
