/**
 * transfer-policy 单元测试
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResolvedAgentAccount } from "../types/index.js";
import { resetServicerCacheForTests, cacheServicers } from "./servicer-cache.js";
import { resolveTransferServicerUserId } from "./transfer-policy.js";
import * as servicerCache from "./servicer-cache.js";

const agent = {
  accountId: "default",
  enabled: true,
  configured: true,
  corpId: "ww",
  corpSecret: "secret",
  token: "t",
  encodingAESKey: "k",
  config: {},
} as ResolvedAgentAccount;

afterEach(() => {
  resetServicerCacheForTests();
  vi.restoreAllMocks();
});

describe("resolveTransferServicerUserId", () => {
  it("显式 servicer_userid 优先", async () => {
    const result = await resolveTransferServicerUserId({
      agent,
      openKfId: "wk1",
      explicitServicerUserId: "lisi",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.servicerUserId).toBe("lisi");
      expect(result.autoSelected).toBe(false);
    }
  });

  it("无显式 userid 时自动选择在线坐席", async () => {
    cacheServicers("wk1", [
      { userid: "offline", status: 1 },
      { userid: "online", status: 0 },
    ]);

    const result = await resolveTransferServicerUserId({
      agent,
      openKfId: "wk1",
      refreshIfStale: false,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.servicerUserId).toBe("online");
      expect(result.autoSelected).toBe(true);
    }
  });

  it("无在线坐席时返回错误", async () => {
    vi.spyOn(servicerCache, "refreshServicersFromApi").mockResolvedValue({
      ok: true,
      count: 0,
    });

    const result = await resolveTransferServicerUserId({
      agent,
      openKfId: "wk1",
      refreshIfStale: true,
    });

    expect(result.ok).toBe(false);
  });
});
