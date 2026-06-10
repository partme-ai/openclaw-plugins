import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import {
  listEnabledWeComAccounts,
  resolveWeComAccountMulti,
} from "./accounts.js";

function cfg(channels: Record<string, unknown>): OpenClawConfig {
  return { channels } as OpenClawConfig;
}

describe("resolveWeComAccountMulti nested bot compatibility", () => {
  it("treats account nested bot as configured running candidate", () => {
    const resolved = resolveWeComAccountMulti({
      cfg: cfg({
        wecom: {
          enabled: true,
          accounts: {
            "cs-assistant": {
              name: "客服助理.AI",
              enabled: true,
              bot: {
                botId: "bot-cs",
                secret: "secret-cs",
                connectionMode: "websocket",
                welcomeText: "您好！",
                streamPlaceholderContent: "正在处理中...",
                dm: { policy: "open" },
              },
            },
          },
        },
      }),
      accountId: "cs-assistant",
    });

    expect(resolved.botId).toBe("bot-cs");
    expect(resolved.secret).toBe("secret-cs");
    expect(resolved.config.connectionMode).toBe("websocket");
    expect(resolved.config.welcomeText).toBe("您好！");
    expect(resolved.config.streamPlaceholderText).toBe("正在处理中...");
    expect(resolved.config.dmPolicy).toBe("open");
    expect(resolved.enabled).toBe(true);
  });

  it("includes nested-bot account in listEnabledWeComAccounts", () => {
    const enabled = listEnabledWeComAccounts(
      cfg({
        wecom: {
          enabled: true,
          accounts: {
            "cs-assistant": {
              enabled: true,
              bot: {
                botId: "bot-cs",
                secret: "secret-cs",
              },
            },
          },
        },
      }),
    );

    expect(enabled.map((a) => a.accountId)).toContain("cs-assistant");
  });

  it("flattens top-level nested bot for default virtual account", () => {
    const resolved = resolveWeComAccountMulti({
      cfg: cfg({
        wecom: {
          enabled: true,
          bot: {
            botId: "top-bot",
            secret: "top-secret",
            connectionMode: "websocket",
          },
        },
      }),
    });

    expect(resolved.accountId).toBe("default");
    expect(resolved.botId).toBe("top-bot");
    expect(resolved.secret).toBe("top-secret");
  });

  it("inherits nested bot credentials from top-level base config", () => {
    const resolved = resolveWeComAccountMulti({
      cfg: cfg({
        wecom: {
          enabled: true,
          dmPolicy: "open",
          bot: {
            botId: "base-bot",
            secret: "base-secret",
            connectionMode: "websocket",
          },
          accounts: {
            "cs-assistant": {
              name: "客服助理.AI",
              enabled: true,
            },
          },
        },
      }),
      accountId: "cs-assistant",
    });

    expect(resolved.name).toBe("客服助理.AI");
    expect(resolved.botId).toBe("base-bot");
    expect(resolved.secret).toBe("base-secret");
    expect(resolved.config.connectionMode).toBe("websocket");
    expect(resolved.config.dmPolicy).toBe("open");
  });

  it("lets account nested bot override base nested bot fields", () => {
    const resolved = resolveWeComAccountMulti({
      cfg: cfg({
        wecom: {
          enabled: true,
          bot: {
            botId: "base-bot",
            secret: "base-secret",
            connectionMode: "webhook",
          },
          accounts: {
            main: {
              bot: {
                connectionMode: "websocket",
                welcomeText: "账号欢迎",
              },
            },
          },
        },
      }),
      accountId: "main",
    });

    expect(resolved.botId).toBe("base-bot");
    expect(resolved.secret).toBe("base-secret");
    expect(resolved.config.connectionMode).toBe("websocket");
    expect(resolved.config.welcomeText).toBe("账号欢迎");
  });

  it("prefers flat account fields over nested bot fields", () => {
    const resolved = resolveWeComAccountMulti({
      cfg: cfg({
        wecom: {
          enabled: true,
          accounts: {
            main: {
              botId: "flat-bot",
              secret: "flat-secret",
              streamPlaceholderText: "flat-placeholder",
              bot: {
                botId: "nested-bot",
                secret: "nested-secret",
                streamPlaceholderContent: "nested-placeholder",
              },
            },
          },
        },
      }),
      accountId: "main",
    });

    expect(resolved.botId).toBe("flat-bot");
    expect(resolved.secret).toBe("flat-secret");
    expect(resolved.config.streamPlaceholderText).toBe("flat-placeholder");
  });

  it("returns the same object reference when resolving the same cfg snapshot twice", () => {
    const config = cfg({
      wecom: {
        enabled: true,
        accounts: {
          main: {
            botId: "flat-bot",
            secret: "flat-secret",
          },
        },
      },
    });

    const first = resolveWeComAccountMulti({ cfg: config, accountId: "main" });
    const second = resolveWeComAccountMulti({ cfg: config, accountId: "main" });

    expect(second).toBe(first);
  });
});
