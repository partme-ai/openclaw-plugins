/**
 * servicer-cache 单元测试
 */

import { describe, expect, it, beforeEach } from "vitest";
import type { ServicerInfo } from "../types/index.js";
import {
  cacheServicers,
  getCachedServicers,
  getOnlineServicers,
  resetServicerCacheForTests,
} from "./servicer-cache.js";

describe("接待人员缓存", () => {
  const mockServicers: ServicerInfo[] = [
    { userid: "user1", status: 0 },
    { userid: "user2", status: 1 },
    { userid: "user3", status: 0 },
  ];

  beforeEach(() => {
    resetServicerCacheForTests();
  });

  it("应缓存和获取接待人员列表", () => {
    cacheServicers("kf_200", mockServicers);
    const cached = getCachedServicers("kf_200");
    expect(cached).toHaveLength(3);
  });

  it("getOnlineServicers 应仅返回 status=0 的接待人员", () => {
    cacheServicers("kf_200", mockServicers);
    const online = getOnlineServicers("kf_200");
    expect(online).toHaveLength(2);
    expect(online.every((s) => s.status === 0)).toBe(true);
  });

  it("未缓存的账号应返回空数组", () => {
    expect(getOnlineServicers("kf_999")).toHaveLength(0);
  });
});
