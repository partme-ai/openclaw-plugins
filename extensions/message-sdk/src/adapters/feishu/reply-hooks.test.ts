import { describe, expect, it, vi } from "vitest";
import {
  createFeishuStyleReplyBundle,
  evaluateFeishuIngressPolicy,
} from "./reply-hooks.js";
import { createAllowlistIngressHook } from "../../ingress/policy.js";

describe("feishu reply-hooks", () => {
  it("evaluates ingress policy", async () => {
    const d = await evaluateFeishuIngressPolicy(
      { channel: "feishu", accountId: "a", peerId: "u1" },
      [createAllowlistIngressHook(new Set(["u1"]))],
    );
    expect(d).toBe("allow");
  });

  it("creates bundle with deliver", async () => {
    const deliver = vi.fn();
    const b = createFeishuStyleReplyBundle({ deliver });
    await b.dispatcherOptions.deliver({ text: "hi" }, { kind: "final" });
    expect(deliver).toHaveBeenCalled();
  });
});
