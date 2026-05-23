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

  it("throws explicit error when legacy outbound accountId does not exist", async () => {
    const { wecomOutbound } = await import("./index.js");
    const cfg = {
      channels: {
        "wecom-kf": {
          enabled: true,
          legacyWecomCsEnabled: true,
          defaultAccount: "acct-a",
          accounts: {
            "acct-a": {
              enabled: true,
              agent: {
                corpId: "corp-a",
                corpSecret: "secret-a",
                agentId: 10001,
                token: "token-a",
                encodingAESKey: "aes-a",
              },
            },
          },
        },
      },
    };
    await expect(
      wecomOutbound.sendText({
        cfg,
        accountId: "acct-missing",
        to: "user:zhangsan",
        text: "hello",
      } as any),
    ).rejects.toThrow(/account "acct-missing" not found/i);
  });

  it("legacy: routes sendText to agent chatId/userid", async () => {
    const { wecomOutbound } = await import("./index.js");
    const api = await import("../agent/api-client.js");
    const now = vi.spyOn(Date, "now").mockReturnValue(123);
    (api.sendText as any).mockResolvedValue(undefined);

    const cfg = {
      channels: {
        "wecom-kf": {
          enabled: true,
          legacyWecomCsEnabled: true,
          agent: {
            corpId: "corp",
            corpSecret: "secret",
            agentId: 1000002,
            token: "token",
            encodingAESKey: "aes",
          },
        },
      },
    };

    await expect(wecomOutbound.sendText({ cfg, to: "wr123", text: "hello" } as any)).rejects.toThrow(
      /不支持向群 chatId 发送/,
    );
    expect(api.sendText).not.toHaveBeenCalled();

    const userResult = await wecomOutbound.sendText({
      cfg,
      to: "userid123",
      text: "hi",
    } as any);
    expect(api.sendText).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: undefined,
        toUser: "userid123",
        text: "hi",
      }),
    );
    expect(userResult.messageId).toBe("agent-123");

    now.mockRestore();
  });

  it("legacy: suppresses /new ack for bot sessions but not agent sessions", async () => {
    const { wecomOutbound } = await import("./index.js");
    const api = await import("../agent/api-client.js");
    const now = vi.spyOn(Date, "now").mockReturnValue(456);
    (api.sendText as any).mockResolvedValue(undefined);
    (api.sendText as any).mockClear();

    const cfg = {
      channels: {
        "wecom-kf": {
          enabled: true,
          legacyWecomCsEnabled: true,
          agent: {
            corpId: "corp",
            corpSecret: "secret",
            agentId: 1000002,
            token: "token",
            encodingAESKey: "aes",
          },
        },
      },
    };

    const ack = "✅ New session started · model: openai-codex/gpt-5.2";

    const r1 = await wecomOutbound.sendText({ cfg, to: "wecom-kf:userid123", text: ack } as any);
    expect(api.sendText).not.toHaveBeenCalled();
    expect(r1.messageId).toBe("suppressed-456");

    (api.sendText as any).mockClear();

    await wecomOutbound.sendText({ cfg, to: "wecom-kf-agent:userid123", text: ack } as any);
    expect(api.sendText).toHaveBeenCalledWith(
      expect.objectContaining({
        toUser: "userid123",
        text: "✅ 已开启新会话（模型：openai-codex/gpt-5.2）",
      }),
    );

    now.mockRestore();
  });

  it("legacy: uses account-scoped agent config in matrix mode", async () => {
    const { wecomOutbound } = await import("./index.js");
    const api = await import("../agent/api-client.js");
    (api.sendText as any).mockResolvedValue(undefined);
    (api.sendText as any).mockClear();

    const cfg = {
      channels: {
        "wecom-kf": {
          enabled: true,
          legacyWecomCsEnabled: true,
          defaultAccount: "acct-a",
          accounts: {
            "acct-a": {
              enabled: true,
              agent: {
                corpId: "corp-a",
                corpSecret: "secret-a",
                agentId: 10001,
                token: "token-a",
                encodingAESKey: "aes-a",
              },
            },
            "acct-b": {
              enabled: true,
              agent: {
                corpId: "corp-b",
                corpSecret: "secret-b",
                agentId: 10002,
                token: "token-b",
                encodingAESKey: "aes-b",
              },
            },
          },
        },
      },
    };

    await wecomOutbound.sendText({
      cfg,
      accountId: "acct-b",
      to: "user:lisi",
      text: "hello b",
    } as any);
    expect(api.sendText).toHaveBeenCalledWith(
      expect.objectContaining({
        toUser: "lisi",
        agent: expect.objectContaining({
          accountId: "acct-b",
          agentId: 10002,
          corpId: "corp-b",
        }),
      }),
    );
  });

  it("legacy: rejects outbound when target account has matrix conflict", async () => {
    const { wecomOutbound } = await import("./index.js");
    const cfg = {
      channels: {
        "wecom-kf": {
          enabled: true,
          legacyWecomCsEnabled: true,
          defaultAccount: "acct-a",
          accounts: {
            "acct-a": {
              enabled: true,
              agent: {
                corpId: "corp-shared",
                corpSecret: "secret-a",
                agentId: 10001,
                token: "token-a",
                encodingAESKey: "aes-a",
              },
            },
            "acct-b": {
              enabled: true,
              agent: {
                corpId: "corp-shared",
                corpSecret: "secret-b",
                agentId: 10001,
                token: "token-b",
                encodingAESKey: "aes-b",
              },
            },
          },
        },
      },
    };

    await expect(
      wecomOutbound.sendText({
        cfg,
        accountId: "acct-b",
        to: "user:lisi",
        text: "hello",
      } as any),
    ).rejects.toThrow(/duplicate wecom agent identity/i);
  });
});
