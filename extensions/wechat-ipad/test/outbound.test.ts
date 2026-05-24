/**
 * WeChat iPad outbound adapter tests.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { wechatIpadSendText } from "../src/outbound.js";
import {
  clearAllSessions,
  getOrCreateSession,
} from "../src/routing/session-mapper.js";

vi.mock("../src/transport/ipad-bridge.js", () => ({
  sendMessage: vi.fn(),
}));

import { sendMessage } from "../src/transport/ipad-bridge.js";

describe("wechatIpadSendText", () => {
  beforeEach(() => {
    clearAllSessions();
    vi.mocked(sendMessage).mockReset();
  });

  it("sends text when sessionKey maps to wxid", async () => {
    const sessionKey = getOrCreateSession("wxid_target", "agent-1", false);
    vi.mocked(sendMessage).mockResolvedValueOnce({ ok: true });

    await wechatIpadSendText(sessionKey, "hello");

    expect(sendMessage).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledWith({
      toWxid: "wxid_target",
      msgType: "text",
      content: "hello",
    });
  });

  it("parses wxid from sessionKey when mapping missing", async () => {
    vi.mocked(sendMessage).mockResolvedValueOnce({ ok: true });

    await wechatIpadSendText("wechat-ipad:wxid_parsed@agent-1", "hi");

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ toWxid: "wxid_parsed", content: "hi" }),
    );
  });

  it("skips send when sessionKey cannot resolve wxid", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await wechatIpadSendText("invalid-key", "noop");
    expect(sendMessage).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("logs error when bridge returns failure", async () => {
    const sessionKey = getOrCreateSession("wxid_fail", "agent-1", false);
    vi.mocked(sendMessage).mockResolvedValueOnce({ ok: false, error: "timeout" });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await wechatIpadSendText(sessionKey, "msg");

    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
