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
