import { describe, expect, it } from "vitest";
import plugin from "../src/index.js";
import { wecomPlugin } from "../src/channel.js";

describe("wecom plugin entry", () => {
  it("exports wecom channel plugin id", () => {
    expect(plugin.id).toBe("wecom");
  });

  it("treats a webhook-only account as configured in every status surface", () => {
    const account = {
      accountId: "default",
      name: "Webhook Bot",
      enabled: true,
      websocketUrl: "wss://openws.work.weixin.qq.com",
      botId: "",
      secret: "",
      sendThinkingMessage: true,
      token: "callback-token",
      encodingAESKey: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
      config: {},
    };

    expect(wecomPlugin.config.isConfigured?.(account)).toBe(true);
    expect(wecomPlugin.config.describeAccount?.(account).configured).toBe(true);
    expect(
      wecomPlugin.status?.buildAccountSnapshot?.({ account, runtime: undefined } as never)
        .configured,
    ).toBe(true);
  });
});
