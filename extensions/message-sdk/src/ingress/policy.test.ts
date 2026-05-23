/**
 * policy.test.ts — 入站 payload 解析、策略链与 UnifiedMessage 归一化。
 *
 * 这些测试锁定该模块的公开契约，防止命名、归一化、幂等或派发路径在重构时发生行为回退。
 */

import { describe, expect, it } from "vitest";
import {
  createAllowlistIngressHook,
  runIngressPolicyChain,
} from "./policy.js";

describe("ingress policy", () => {
  it("denies when not in allowlist", async () => {
    const d = await runIngressPolicyChain(
      { channel: "feishu", accountId: "a", peerId: "u1", rawIdentity: "u2" },
      { hooks: [createAllowlistIngressHook(new Set(["u1"]))] },
    );
    expect(d).toBe("deny");
  });

  it("allows wildcard", async () => {
    const d = await runIngressPolicyChain(
      { channel: "feishu", accountId: "a", peerId: "any" },
      { hooks: [createAllowlistIngressHook(new Set(["*"]))] },
    );
    expect(d).toBe("allow");
  });
});
