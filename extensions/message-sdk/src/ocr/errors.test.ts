/**
 * OCR 错误类 单元测试
 */
import { describe, it, expect } from "vitest";
import {
  OCRError,
  OCRTimeoutError,
  OCRAuthError,
  OCRRequestError,
  OCRResponseParseError,
  OCRServiceError,
  OCREmptyResultError,
  OCRUnsupportedFormatError,
} from "./errors.ts";

describe("OCRError", () => {
  it("基类携带 kind/provider/retryable", () => {
    const err = new OCRError("test", "service", "deepseek", true);
    expect(err.name).toBe("OCRError");
    expect(err.kind).toBe("service");
    expect(err.provider).toBe("deepseek");
    expect(err.retryable).toBe(true);
  });
});

describe("OCRTimeoutError", () => {
  it("可重试", () => {
    const err = new OCRTimeoutError("deepseek", 30000);
    expect(err.kind).toBe("timeout");
    expect(err.retryable).toBe(true);
    expect(err.timeoutMs).toBe(30000);
  });
});

describe("OCRAuthError", () => {
  it("不可重试", () => {
    const err = new OCRAuthError("glm", "Unauthorized", 403);
    expect(err.kind).toBe("auth");
    expect(err.retryable).toBe(false);
  });
});

describe("OCRRequestError", () => {
  it("可重试", () => {
    const err = new OCRRequestError("paddleocr", "timeout", 504);
    expect(err.kind).toBe("request");
    expect(err.retryable).toBe(true);
  });
});

describe("OCRResponseParseError", () => {
  it("不可重试", () => {
    const err = new OCRResponseParseError("qianfan", "{bad json");
    expect(err.kind).toBe("response_parse");
    expect(err.retryable).toBe(false);
    expect(err.bodySnippet).toBe("{bad json");
  });
});

describe("OCRServiceError", () => {
  it("不可重试", () => {
    const err = new OCRServiceError("deepseek", "rate limited", 429);
    expect(err.kind).toBe("service");
    expect(err.retryable).toBe(false);
  });
});

describe("OCREmptyResultError", () => {
  it("不可重试", () => {
    const err = new OCREmptyResultError("glm");
    expect(err.kind).toBe("empty_result");
    expect(err.retryable).toBe(false);
  });
});

describe("OCRUnsupportedFormatError", () => {
  it("不可重试", () => {
    const err = new OCRUnsupportedFormatError("paddleocr", "bmp");
    expect(err.kind).toBe("unsupported_format");
    expect(err.retryable).toBe(false);
    expect(err.format).toBe("bmp");
  });
});

describe("OCR 错误继承链", () => {
  it("所有子类都是 OCRError 的实例", () => {
    expect(new OCRTimeoutError("t", 1000)).toBeInstanceOf(OCRError);
    expect(new OCRAuthError("t", "m")).toBeInstanceOf(OCRError);
    expect(new OCRRequestError("t", "m")).toBeInstanceOf(OCRError);
    expect(new OCRResponseParseError("t", "b")).toBeInstanceOf(OCRError);
    expect(new OCRServiceError("t", "m")).toBeInstanceOf(OCRError);
    expect(new OCREmptyResultError("t")).toBeInstanceOf(OCRError);
    expect(new OCRUnsupportedFormatError("t", "f")).toBeInstanceOf(OCRError);
  });
});
