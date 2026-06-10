import { describe, expect, it, vi } from "vitest";

vi.mock("../agent/api-client.js", () => ({
  sendText: vi.fn(),
  sendMedia: vi.fn(),
  uploadMedia: vi.fn(),
  sendKfTextMessage: vi.fn(),
  sendKfMediaMessage: vi.fn(),
  summarizeSendResults: vi.fn((results: Array<{ errcode: number; msgid?: string; errmsg: string }>) => {
    const failed = results.find((r) => r.errcode !== 0);
    if (failed) return { ok: false, error: failed.errmsg };
    return { ok: true, msgid: results[results.length - 1]?.msgid ?? "kf-msg-1" };
  }),
}));

vi.mock("../media/path-guard.js", () => ({
  getExtendedMediaLocalRoots: vi.fn(async () => ["/tmp"]),
  readGuardedLocalMediaFile: vi.fn(async () => ({
    ok: true,
    buffer: Buffer.from("fake-image"),
  })),
}));

describe("wecomOutbound", () => {
  it("KF-only sendMedia uses sendKfMediaMessage", async () => {
    const { wecomOutbound } = await import("./index.js");
    const api = await import("../agent/api-client.js");
    (api.sendKfTextMessage as ReturnType<typeof vi.fn>).mockResolvedValue([
      { errcode: 0, errmsg: "ok", msgid: "kf-caption" },
    ]);
    (api.sendKfMediaMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      errcode: 0,
      errmsg: "ok",
      msgid: "kf-media-1",
    });

    const cfg = {
      channels: {
        "wecom-kf": {
          enabled: true,
          corpId: "corp",
          corpSecret: "secret",
          openKfId: "wk123",
          token: "token",
          encodingAESKey: "aes",
        },
      },
    };

    const result = await wecomOutbound.sendMedia!({
      cfg,
      to: "user:external_user_1",
      text: "caption",
      mediaUrl: "/tmp/test.png",
    } as any);

    expect(api.sendKfMediaMessage).toHaveBeenCalled();
    expect(result.channel).toBe("wecom-kf");
    expect(result.messageId).toBe("kf-media-1");
  });

  it("KF-only sendText uses sendKfTextMessage", async () => {
    const { wecomOutbound } = await import("./index.js");
    const api = await import("../agent/api-client.js");
    (api.sendKfTextMessage as any).mockResolvedValue([{ errcode: 0, errmsg: "ok", msgid: "kf-99" }]);

    const cfg = {
      channels: {
        "wecom-kf": {
          enabled: true,
          corpId: "corp",
          corpSecret: "secret",
          openKfId: "wk123",
          token: "token",
          encodingAESKey: "aes",
        },
      },
    };

    const result = await wecomOutbound.sendText({
      cfg,
      to: "user:external_user_1",
      text: "hello kf",
    } as any);

    expect(api.sendKfTextMessage).toHaveBeenCalled();
    expect(result.channel).toBe("wecom-kf");
    expect(result.messageId).toBe("kf-99");
  });
});
