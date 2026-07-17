import { beforeEach, describe, expect, it, vi } from "vitest";
import { wechatIpadOutbound } from "../src/outbound.js";

vi.mock("../src/transport/ipad-bridge.js", () => ({ sendMessage: vi.fn() }));
import { sendMessage } from "../src/transport/ipad-bridge.js";

describe("wechatIpadOutbound", () => {
  beforeEach(() => vi.mocked(sendMessage).mockReset());

  it("implements the OpenClaw 2026.7.1 outbound context contract", async () => {
    vi.mocked(sendMessage).mockResolvedValue({ ok: true, data: { msgId: "m-1" } });
    const result = await wechatIpadOutbound.sendText!({
      cfg: {} as never,
      to: "wechat-ipad:wxid_target",
      text: "hello",
    });
    expect(sendMessage).toHaveBeenCalledWith({
      toWxid: "wxid_target",
      msgType: "text",
      content: "hello",
    });
    expect(result).toMatchObject({ channel: "wechat-ipad", messageId: "m-1" });
  });

  it("throws on invalid targets and bridge failures", async () => {
    await expect(wechatIpadOutbound.sendText!({ cfg: {} as never, to: "bad target", text: "x" }))
      .rejects.toThrow("invalid outbound target");
    vi.mocked(sendMessage).mockResolvedValue({ ok: false, error: "timeout" });
    await expect(wechatIpadOutbound.sendText!({ cfg: {} as never, to: "wxid_ok", text: "x" }))
      .rejects.toThrow("timeout");
  });
});
