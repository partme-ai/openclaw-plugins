import { describe, expect, it } from "vitest";
import { flattenWecomBotFields } from "./bot-config-normalize.js";

describe("flattenWecomBotFields", () => {
  it("maps nested account bot fields to flat runtime keys", () => {
    const flat = flattenWecomBotFields({
      name: "客服助理.AI",
      enabled: true,
      bot: {
        botId: "bot-nested-id",
        secret: "nested-secret",
        connectionMode: "websocket",
        welcomeText: "您好！",
        streamPlaceholderContent: "正在处理中...",
        dm: { policy: "open" },
      },
    });

    expect(flat.bot).toBeUndefined();
    expect(flat.botId).toBe("bot-nested-id");
    expect(flat.secret).toBe("nested-secret");
    expect(flat.connectionMode).toBe("websocket");
    expect(flat.welcomeText).toBe("您好！");
    expect(flat.streamPlaceholderText).toBe("正在处理中...");
    expect(flat.dmPolicy).toBe("open");
  });

  it("lets flat fields override nested bot values", () => {
    const flat = flattenWecomBotFields({
      botId: "flat-id",
      secret: "flat-secret",
      dmPolicy: "allowlist",
      allowFrom: ["admin"],
      bot: {
        botId: "nested-id",
        secret: "nested-secret",
        dm: { policy: "open", allowFrom: ["other"] },
      },
    });

    expect(flat.botId).toBe("flat-id");
    expect(flat.secret).toBe("flat-secret");
    expect(flat.dmPolicy).toBe("allowlist");
    expect(flat.allowFrom).toEqual(["admin"]);
  });

  it("maps bot.dmPolicy flat inside nested bot block", () => {
    const flat = flattenWecomBotFields({
      bot: {
        dmPolicy: "allowlist",
        allowFrom: ["admin"],
      },
    });

    expect(flat.dmPolicy).toBe("allowlist");
    expect(flat.allowFrom).toEqual(["admin"]);
  });

  it("maps bot.dm.allow alias to allowFrom", () => {
    const flat = flattenWecomBotFields({
      bot: {
        dm: { policy: "allowlist", allow: ["user-a"] },
      },
    });

    expect(flat.dmPolicy).toBe("allowlist");
    expect(flat.allowFrom).toEqual(["user-a"]);
  });

  it("maps top-level streamPlaceholderContent alias", () => {
    const flat = flattenWecomBotFields({
      streamPlaceholderContent: "legacy-top-level",
    });

    expect(flat.streamPlaceholderText).toBe("legacy-top-level");
  });

  it("preserves nested agent block untouched", () => {
    const flat = flattenWecomBotFields({
      bot: { botId: "b1", secret: "s1" },
      agent: {
        corpId: "corp",
        corpSecret: "secret",
        token: "token",
        encodingAESKey: "key",
      },
    });

    expect(flat.agent).toEqual({
      corpId: "corp",
      corpSecret: "secret",
      token: "token",
      encodingAESKey: "key",
    });
  });
});
