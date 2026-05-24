/**
 * http-retry 单元测试：瞬态/永久错误分类与重试行为。
 */
import { describe, expect, it, vi } from "vitest";
import {
  isTransientHttpStatus,
  parseWeComErrcode,
  shouldRetryWeComFetchError,
  shouldRetryWeComHttpResponse,
  WeComTransientHttpError,
  retryWeComFetch,
  WECOM_NON_RETRYABLE_ERRCODES,
} from "./http-retry.js";

describe("isTransientHttpStatus", () => {
  it("treats 429 and 5xx as transient", () => {
    expect(isTransientHttpStatus(429)).toBe(true);
    expect(isTransientHttpStatus(500)).toBe(true);
    expect(isTransientHttpStatus(503)).toBe(true);
  });

  it("does not treat 4xx (except 429) as transient", () => {
    expect(isTransientHttpStatus(400)).toBe(false);
    expect(isTransientHttpStatus(401)).toBe(false);
    expect(isTransientHttpStatus(404)).toBe(false);
  });
});

describe("parseWeComErrcode", () => {
  it("parses errcode from WeCom API error messages", () => {
    expect(parseWeComErrcode(new Error("send failed: 60020 not allow to access from your ip"))).toBe(60020);
    expect(parseWeComErrcode(new Error("upload failed: 40014 invalid access_token"))).toBe(40014);
  });

  it("returns undefined for unrelated errors", () => {
    expect(parseWeComErrcode(new Error("fetch failed"))).toBeUndefined();
  });
});

describe("shouldRetryWeComFetchError", () => {
  it("does not retry WeCom 60020 IP whitelist", () => {
    expect(
      shouldRetryWeComFetchError(new Error("gettoken failed: 60020 not allow to access from your ip")),
    ).toBe(false);
    expect(WECOM_NON_RETRYABLE_ERRCODES.has(60020)).toBe(true);
  });

  it("does not retry auth/token errors", () => {
    expect(shouldRetryWeComFetchError(new Error("invalid access_token"))).toBe(false);
    expect(shouldRetryWeComFetchError(new Error("invalid secret"))).toBe(false);
  });

  it("does not retry AbortError", () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    expect(shouldRetryWeComFetchError(err)).toBe(false);
  });

  it("retries network failures and transient HTTP errors", () => {
    expect(shouldRetryWeComFetchError(new TypeError("fetch failed"))).toBe(true);
    expect(shouldRetryWeComFetchError(new WeComTransientHttpError(503))).toBe(true);
    expect(shouldRetryWeComFetchError(new WeComTransientHttpError(429))).toBe(true);
  });

  it("does not retry permanent 4xx HTTP errors", () => {
    expect(shouldRetryWeComFetchError(new WeComTransientHttpError(401))).toBe(false);
    expect(shouldRetryWeComFetchError(new WeComTransientHttpError(400))).toBe(false);
  });
});

describe("shouldRetryWeComHttpResponse", () => {
  it("matches transient status codes", () => {
    expect(shouldRetryWeComHttpResponse({ status: 502 } as Response)).toBe(true);
    expect(shouldRetryWeComHttpResponse({ status: 403 } as Response)).toBe(false);
  });
});

describe("retryWeComFetch", () => {
  it("retries transient failures then succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new WeComTransientHttpError(503))
      .mockResolvedValueOnce("ok");

    await expect(retryWeComFetch(fn, { attempts: 2, minDelayMs: 1, maxDelayMs: 2 })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry permanent WeCom errcode", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("send failed: 60020 ip blocked"));

    await expect(retryWeComFetch(fn, { attempts: 3, minDelayMs: 1, maxDelayMs: 2 })).rejects.toThrow("60020");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
