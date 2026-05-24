/**
 * Rednode outbound reply tests.
 */
import { describe, expect, it } from "vitest";

import { deliverXhsAgentReplyPayload } from "../src/dispatch/outbound-reply.js";

describe("deliverXhsAgentReplyPayload", () => {
  it("accepts text-only agent reply", async () => {
    const logs: string[] = [];
    const result = await deliverXhsAgentReplyPayload({
      cfg: { channels: {} },
      shopId: "shop-1",
      peerId: "shop-1",
      text: "小红书回复",
      log: (msg) => logs.push(msg),
    });
    expect(result.ok).toBe(true);
    expect(logs.some((l) => l.includes("[rednode]"))).toBe(true);
  });

  it("rejects empty reply without media", async () => {
    const result = await deliverXhsAgentReplyPayload({
      cfg: { channels: {} },
      shopId: "shop-1",
      peerId: "shop-1",
      text: "  ",
    });
    expect(result).toEqual({ ok: false, error: "empty agent reply" });
  });

  it("returns error when media path missing on disk", async () => {
    const result = await deliverXhsAgentReplyPayload({
      cfg: { channels: {} },
      shopId: "shop-1",
      peerId: "shop-1",
      text: "MEDIA: /tmp/xhs-missing.png\n说明",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
