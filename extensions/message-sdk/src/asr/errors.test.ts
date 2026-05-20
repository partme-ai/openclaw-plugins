/**
 * ASR 错误类 单元测试
 */
import { describe, it, expect } from "vitest";
import {
  ASRError,
  ASRTimeoutError,
  ASRAuthError,
  ASRRequestError,
  ASRResponseParseError,
  ASRServiceError,
  ASREmptyResultError,
} from "./errors.ts";

describe("ASRError", () => {
  it("基类携带 kind/provider/retryable", () => {
    const err = new ASRError("test error", "service", "tencent", true);
    expect(err.name).toBe("ASRError");
    expect(err.kind).toBe("service");
    expect(err.provider).toBe("tencent");
    expect(err.retryable).toBe(true);
    expect(err.message).toBe("test error");
  });

  it("默认不可重试", () => {
    const err = new ASRError("err", "auth", "baidu");
    expect(err.retryable).toBe(false);
  });
});

describe("ASRTimeoutError", () => {
  it("可重试超时错误", () => {
    const err = new ASRTimeoutError("tencent", 15000);
    expect(err.kind).toBe("timeout");
    expect(err.provider).toBe("tencent");
    expect(err.timeoutMs).toBe(15000);
    expect(err.retryable).toBe(true);
  });
});

describe("ASRAuthError", () => {
  it("不可重试认证错误", () => {
    const err = new ASRAuthError("aliyun", "Invalid key", 401);
    expect(err.kind).toBe("auth");
    expect(err.retryable).toBe(false);
    expect(err.status).toBe(401);
  });
});

describe("ASRRequestError", () => {
  it("可重试请求错误", () => {
    const err = new ASRRequestError("tencent", "Network error", 503);
    expect(err.kind).toBe("request");
    expect(err.retryable).toBe(true);
    expect(err.status).toBe(503);
  });
});

describe("ASRResponseParseError", () => {
  it("不可重试解析错误", () => {
    const err = new ASRResponseParseError("baidu", "{invalid json");
    expect(err.kind).toBe("response_parse");
    expect(err.retryable).toBe(false);
    expect(err.bodySnippet).toBe("{invalid json");
  });
});

describe("ASRServiceError", () => {
  it("不可重试服务错误", () => {
    const err = new ASRServiceError("aliyun", "Quota exceeded", 10001);
    expect(err.kind).toBe("service");
    expect(err.retryable).toBe(false);
    expect(err.serviceCode).toBe(10001);
  });
});

describe("ASREmptyResultError", () => {
  it("不可重试空结果", () => {
    const err = new ASREmptyResultError("tencent");
    expect(err.kind).toBe("empty_result");
    expect(err.retryable).toBe(false);
    expect(err.message).toContain("empty transcript");
  });
});

describe("ASR 错误继承链", () => {
  it("所有子类都是 ASRError 的实例", () => {
    expect(new ASRTimeoutError("t", 1000)).toBeInstanceOf(ASRError);
    expect(new ASRAuthError("t", "m")).toBeInstanceOf(ASRError);
    expect(new ASRRequestError("t", "m")).toBeInstanceOf(ASRError);
    expect(new ASRResponseParseError("t", "b")).toBeInstanceOf(ASRError);
    expect(new ASRServiceError("t", "m")).toBeInstanceOf(ASRError);
    expect(new ASREmptyResultError("t")).toBeInstanceOf(ASRError);
  });

  it("所有子类都是 Error 的实例", () => {
    expect(new ASRTimeoutError("t", 1000)).toBeInstanceOf(Error);
  });
});
