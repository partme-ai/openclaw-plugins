/**
 * Meituan outbound reply and stub sendText tests.
 */
import { describe, expect, it } from "vitest";

import { deliverMeituanAgentReplyPayload } from "../src/dispatch/outbound-reply.js";
import { meituanSendText } from "../src/outbound.js";

describe("deliverMeituanAgentReplyPayload", () => {
  it("accepts text-only agent reply", async () => {
    const logs: string[] = [];
    const result = await deliverMeituanAgentReplyPayload({
      cfg: { channels: {} },
      shopId: "shop-1",
      peerId: "shop-1",
      text: "美团回复",
      log: (msg) => logs.push(msg),
    });
    expect(result.ok).toBe(true);
    expect(logs.some((l) => l.includes("出站文本"))).toBe(true);
  });

  it("rejects empty reply without media", async () => {
    const result = await deliverMeituanAgentReplyPayload({
      cfg: { channels: {} },
      shopId: "shop-1",
      peerId: "shop-1",
      text: "",
    });
    expect(result).toEqual({ ok: false, error: "empty agent reply" });
  });

  it("merges explicit mediaUrls with MEDIA directives", async () => {
    const result = await deliverMeituanAgentReplyPayload({
      cfg: { channels: {} },
      shopId: "shop-1",
      peerId: "shop-1",
      text: "说明",
      mediaUrls: ["/tmp/meituan-missing-media.png"],
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

describe("meituanSendText", () => {
  it("returns ok for plain text", async () => {
    const result = await meituanSendText({ text: "hello", to: "shop-1" });
    expect(result.ok).toBe(true);
  });

  it("returns ok when MEDIA directives present", async () => {
    const result = await meituanSendText({
      text: "MEDIA: /tmp/x.png\n说明",
      to: "shop-1",
    });
    expect(result.ok).toBe(true);
  });
});
