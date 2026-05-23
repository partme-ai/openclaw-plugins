import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig, PluginRuntime } from "openclaw/plugin-sdk";

import { dispatchKfMessage } from "./dispatch.js";
import type { KfMessage, WecomAccountConfig } from "./types/index.js";

function createAccountConfig(): WecomAccountConfig {
  return {
    corpId: "ww-test-corp",
    corpSecret: "kf-secret",
    openKfId: "wk-test",
    token: "callback-token",
    encodingAESKey: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
    welcomeText: "你好",
  };
}

function createTextMessage(): KfMessage {
  return {
    msgid: "msg-1",
    msgtype: "text",
    origin: 3,
    open_kfid: "wk-test",
    external_userid: "wx-user-1",
    text: { content: "hello from customer" },
  };
}

function createRuntime(
  dispatchReplyWithBufferedBlockDispatcher: NonNullable<
    NonNullable<PluginRuntime["channel"]>["reply"]
  >["dispatchReplyWithBufferedBlockDispatcher"],
): PluginRuntime {
  return {
    channel: {
      commands: {
        shouldComputeCommandAuthorized: vi.fn(() => false),
      },
      routing: {
        resolveAgentRoute: () => ({
          sessionKey: "session-1",
          accountId: "wk-test",
          agentId: "agent-1",
        }),
      },
      reply: {
        dispatchReplyWithBufferedBlockDispatcher,
        finalizeInboundContext: (ctx: Record<string, unknown>) => ctx,
      },
      session: {
        resolveStorePath: () => "/tmp/session",
        recordInboundSession: vi.fn(async () => undefined),
      },
      pairing: {
        readAllowFromStore: vi.fn(async () => []),
        upsertPairingRequest: vi.fn(async () => ({ code: "123", created: true })),
        buildPairingReply: vi.fn(() => "pairing"),
      },
    },
  } as unknown as PluginRuntime;
}

const cfg = {
  channels: {
    "wecom-kf": {
      enabled: true,
      accounts: {
        default: {
          openKfId: "wk-test",
          corpId: "ww-test-corp",
          corpSecret: "kf-secret",
        },
      },
    },
  },
} as OpenClawConfig;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("wecom-kf dispatch", () => {
  it("does not send outbound messages when the reply pipeline yields no visible payload", async () => {
    const fetchMock = vi.fn();
    const dispatchReplyWithBufferedBlockDispatcher = vi.fn(async () => undefined);
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    await dispatchKfMessage({
      cfg,
      accountConfig: createAccountConfig(),
      msg: createTextMessage(),
      core: createRuntime(dispatchReplyWithBufferedBlockDispatcher),
    });

    expect(dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips non origin=3 text messages", async () => {
    const dispatchReplyWithBufferedBlockDispatcher = vi.fn(async () => undefined);

    await dispatchKfMessage({
      cfg,
      accountConfig: createAccountConfig(),
      msg: {
        ...createTextMessage(),
        origin: 4,
        msgtype: "event",
      },
      core: createRuntime(dispatchReplyWithBufferedBlockDispatcher),
    });

    expect(dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled();
  });
});
