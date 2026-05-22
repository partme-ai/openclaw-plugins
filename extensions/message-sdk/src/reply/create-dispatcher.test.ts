import { describe, expect, it, vi } from "vitest";
import { preprocessOutboundReply } from "./create-dispatcher.js";

describe("preprocessOutboundReply", () => {
  it("strips MEDIA directives and merges media urls", async () => {
    const r = await preprocessOutboundReply({
      payload: { text: "hi\nMEDIA: /tmp/a.png\n", mediaUrls: ["https://x/y.png"] },
    });
    expect(r.text).toBe("hi");
    expect(r.mediaUrls).toContain("/tmp/a.png");
    expect(r.mediaUrls).toContain("https://x/y.png");
    expect(r.hasMedia).toBe(true);
  });

  it("applies reasoning formatter", async () => {
    const formatReasoning = vi.fn((t: string) => `[r]${t}`);
    const r = await preprocessOutboundReply({
      payload: { text: "thought", isReasoning: true },
      formatReasoning,
    });
    expect(formatReasoning).toHaveBeenCalled();
    expect(r.text).toContain("[r]");
  });
});
