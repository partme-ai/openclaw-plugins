/**
 * 路由幂等去重单元测试
 */

import { describe, it, expect, beforeEach } from "vitest";
import { RouteDedupeCache, buildRouteDedupeKey } from "../src/dedupe.ts";

describe("RouteDedupeCache", () => {
  let cache: RouteDedupeCache;

  beforeEach(() => {
    cache = new RouteDedupeCache(60_000, 100);
  });

  it("首次键不应跳过", () => {
    expect(cache.shouldSkip("run-1:rule-a:inbound")).toBe(false);
  });

  it("相同键第二次应跳过", () => {
    const key = "run-1:rule-a:inbound";
    expect(cache.shouldSkip(key)).toBe(false);
    expect(cache.shouldSkip(key)).toBe(true);
  });

  it("clear 后相同键不再跳过", () => {
    const key = "run-1:rule-a:inbound";
    cache.shouldSkip(key);
    cache.clear();
    expect(cache.shouldSkip(key)).toBe(false);
  });
});

describe("buildRouteDedupeKey", () => {
  it("过滤空段并拼接", () => {
    expect(buildRouteDedupeKey(["run-1", undefined, "rule-a", ""])).toBe("run-1:rule-a");
  });
});
