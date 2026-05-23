/**
 * HTTP 客户端单元测试 — 错误类 + 重试策略
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  HttpError,
  TimeoutError,
  defaultShouldRetry,
  withRetry,
  httpPost,
  httpGet,
} from "./http-client.ts";

// ============================================================================
// HttpError
// ============================================================================

describe("HttpError", () => {
  it("携带状态码和响应体", () => {
    const err = new HttpError("Not Found", 404, "page not found");
    expect(err.name).toBe("HttpError");
    expect(err.status).toBe(404);
    expect(err.body).toBe("page not found");
    expect(err.message).toBe("Not Found");
  });

  it("无响应体", () => {
    const err = new HttpError("Server Error", 500);
    expect(err.body).toBeUndefined();
  });

  it("继承自 Error", () => {
    expect(new HttpError("x", 400)).toBeInstanceOf(Error);
  });
});

// ============================================================================
// TimeoutError
// ============================================================================

describe("TimeoutError", () => {
  it("携带超时时间", () => {
    const err = new TimeoutError("timeout", 15000);
    expect(err.name).toBe("TimeoutError");
    expect(err.timeoutMs).toBe(15000);
  });

  it("继承自 Error", () => {
    expect(new TimeoutError("x", 1000)).toBeInstanceOf(Error);
  });
});

// ============================================================================
// defaultShouldRetry
// ============================================================================

describe("defaultShouldRetry", () => {
  it("网络错误可重试", () => {
    const err = new TypeError("fetch failed");
    expect(defaultShouldRetry(err)).toBe(true);
  });

  it("超时可重试", () => {
    const err = new TimeoutError("t/o", 3000);
    expect(defaultShouldRetry(err)).toBe(true);
  });

  it("5xx 可重试", () => {
    const err = new HttpError("Server Error", 500);
    expect(defaultShouldRetry(err)).toBe(true);
    const err2 = new HttpError("Bad Gateway", 502);
    expect(defaultShouldRetry(err2)).toBe(true);
    const err3 = new HttpError("Gateway Timeout", 504);
    expect(defaultShouldRetry(err3)).toBe(true);
  });

  it("4xx 不可重试", () => {
    const err = new HttpError("Bad Request", 400);
    expect(defaultShouldRetry(err)).toBe(false);
    const err2 = new HttpError("Not Found", 404);
    expect(defaultShouldRetry(err2)).toBe(false);
  });

  it("非 Error 类型不重试", () => {
    expect(defaultShouldRetry("string error")).toBe(false);
    expect(defaultShouldRetry(123)).toBe(false);
    expect(defaultShouldRetry(null)).toBe(false);
  });

  it("普通 Error 不重试", () => {
    expect(defaultShouldRetry(new Error("generic"))).toBe(false);
  });
});

// ============================================================================
// withRetry
// ============================================================================

describe("withRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("成功时直接返回", async () => {
    const fn = vi.fn().mockResolvedValue("success");
    const result = await withRetry(fn, { maxRetries: 2 });
    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("第一次失败第二次成功时重试", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new TypeError("network error"))
      .mockResolvedValueOnce("recovered");

    const promise = withRetry(fn, {
      maxRetries: 3,
      initialDelay: 100,
      backoffMultiplier: 2,
    });

    // 第一次失败后: sleep(100 * 2^0 = 100)
    await vi.advanceTimersByTimeAsync(100);

    const result = await promise;
    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("超过最大重试次数后抛出", async () => {
    const err = new TypeError("always fails");
    const fn = vi.fn().mockRejectedValue(err);

    const promise = withRetry(fn, {
      maxRetries: 2,
      initialDelay: 10,
    });
    const assertion = expect(promise).rejects.toBe(err);

    // 第一次重试: sleep(10 * 2^0 = 10)
    await vi.advanceTimersByTimeAsync(10);
    // 第二次重试: sleep(10 * 2^1 = 20)
    await vi.advanceTimersByTimeAsync(20);

    await assertion;
    expect(fn).toHaveBeenCalledTimes(3);
  }, 10000);

  it("不可重试错误直接抛出", async () => {
    const err = new HttpError("Bad Request", 400);
    const fn = vi.fn().mockRejectedValue(err);

    await expect(withRetry(fn, { maxRetries: 3 })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1); // 不重试
  });

  it("自定义 shouldRetry", async () => {
    let callCount = 0;
    const fn = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.reject(new Error(`attempt ${callCount}`));
    });

    // 始终不重试
    await expect(withRetry(fn, {
      maxRetries: 3,
      initialDelay: 10,
      shouldRetry: () => false,
    })).rejects.toBeDefined();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("指数退避延迟", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new TypeError("fail1"))
      .mockRejectedValueOnce(new TypeError("fail2"))
      .mockResolvedValueOnce("ok");

    const promise = withRetry(fn, {
      maxRetries: 3,
      initialDelay: 1000,
      maxDelay: 10000,
      backoffMultiplier: 2,
    });

    // 第一次 sleep: 1000 * 2^0 = 1000
    await vi.advanceTimersByTimeAsync(1000);
    // 第二次 sleep: 1000 * 2^1 = 2000
    await vi.advanceTimersByTimeAsync(2000);

    await promise;
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

// ============================================================================
// httpPost / httpGet (结构测试，不发起真实请求)
// ============================================================================

describe("httpPost / httpGet exports", () => {
  it("httpPost 是函数", () => {
    expect(typeof httpPost).toBe("function");
  });

  it("httpGet 是函数", () => {
    expect(typeof httpGet).toBe("function");
  });

  it("withRetry 是函数", () => {
    expect(typeof withRetry).toBe("function");
  });

  it("defaultShouldRetry 是函数", () => {
    expect(typeof defaultShouldRetry).toBe("function");
  });
});
