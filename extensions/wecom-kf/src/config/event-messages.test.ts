import { describe, expect, it } from "vitest";

import { setWecomRuntime } from "../runtime/index.js";
import { extractEventMessageText, getEventMessagesConfig } from "./event-messages.js";

describe("getEventMessagesConfig", () => {
  it("uses OpenClaw 2026.7.1 runtime.config.current and resolves account by open_kfid", async () => {
    setWecomRuntime({
      config: {
        current: () => ({
          channels: {
            "wecom-kf": {
              enabled: true,
              eventMessages: {
                welcome: {
                  enabled: true,
                  msgtype: "text",
                  content: { text: { content: "channel welcome" } },
                },
              },
              accounts: {
                desk: {
                  openKfId: "wk-account-1",
                  agentId: "agent-1",
                  corpId: "ww-corp",
                  token: "token",
                  encodingAESKey: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
                  eventMessages: {
                    welcome: {
                      enabled: true,
                      msgtype: "text",
                      content: { text: { content: "account welcome" } },
                    },
                  },
                },
              },
            },
          },
        }),
      },
    } as never);

    const resolved = await getEventMessagesConfig("wk-account-1");
    expect(extractEventMessageText(resolved.welcome)).toBe("account welcome");
  });
});
