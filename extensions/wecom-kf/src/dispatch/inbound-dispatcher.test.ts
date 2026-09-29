import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig, PluginRuntime } from "openclaw/plugin-sdk/core";

import { dispatchKfMessage } from "./inbound-dispatcher.js";
import type { KfMessage, WecomAccountConfig } from "../types/index.js";
import { TranscriptDispatchError } from "@partme.ai/openclaw-message-sdk";

const deliverReplyMock = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock("../outbound/kf-send.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../outbound/kf-send.js")>()),
  deliverKfAgentReplyPayload: deliverReplyMock,
}));

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
      inbound: {
        dispatchReply: vi.fn(async (turn) => {
          await turn.recordInboundSession({
            storePath: turn.storePath,
            sessionKey: turn.routeSessionKey,
            ctx: turn.ctxPayload,
            onRecordError: turn.record?.onRecordError ?? (() => undefined),
          });
          await turn.dispatchReplyWithBufferedBlockDispatcher({
            ctx: turn.ctxPayload,
            cfg: turn.cfg,
            dispatcherOptions: { deliver: turn.delivery.deliver },
          });
          return {
            admission: { kind: "dispatch" },
            dispatched: true,
            routeSessionKey: turn.routeSessionKey,
            ctxPayload: turn.ctxPayload,
            dispatchResult: { queuedFinal: false, counts: { tool: 0, block: 0, final: 0 } },
          };
        }),
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
          agentId: "agent-1",
          corpId: "ww-test-corp",
          corpSecret: "kf-secret",
          token: "callback-token",
          encodingAESKey: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
        },
      },
    },
  },
} as OpenClawConfig;

afterEach(() => {
  deliverReplyMock.mockReset();
  deliverReplyMock.mockResolvedValue({ ok: true });
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

  it("does not treat a failed platform delivery after recording as a completed turn", async () => {
    deliverReplyMock.mockResolvedValueOnce({ ok: false, error: "platform rejected" });
    const dispatchReplyWithBufferedBlockDispatcher = vi.fn(async ({ dispatcherOptions }) => {
      await dispatcherOptions.deliver({ text: "reply" });
    });
    await expect(dispatchKfMessage({
      cfg,
      accountConfig: createAccountConfig(),
      msg: createTextMessage(),
      core: createRuntime(dispatchReplyWithBufferedBlockDispatcher),
    })).rejects.toMatchObject({ recordState: "recorded" } satisfies Partial<TranscriptDispatchError>);
    expect(deliverReplyMock).toHaveBeenCalledTimes(1);
  });

  it("reports unavailable inbound capability as not started so the callback can retry", async () => {
    const runtime = createRuntime(vi.fn());
    (runtime.channel.inbound as { dispatchReply?: unknown }).dispatchReply = undefined;
    await expect(dispatchKfMessage({
      cfg, accountConfig: createAccountConfig(), msg: createTextMessage(), core: runtime,
    })).rejects.toMatchObject({ recordState: "not_started" } satisfies Partial<TranscriptDispatchError>);
  });

  it("does not accept a false dispatch admission as a policy terminal result", async () => {
    const runtime = createRuntime(vi.fn());
    (runtime.channel.inbound as { dispatchReply: unknown }).dispatchReply = vi.fn(async () => ({
      admission: { kind: "dispatch" }, dispatched: false,
    }));
    await expect(dispatchKfMessage({
      cfg, accountConfig: createAccountConfig(), msg: createTextMessage(), core: runtime,
    })).rejects.toMatchObject({ recordState: "ambiguous" } satisfies Partial<TranscriptDispatchError>);
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

  it("does not expose external_userid when DM policy rejects an inbound message", async () => {
    const log = vi.fn();
    const dispatchReplyWithBufferedBlockDispatcher = vi.fn(async () => undefined);
    const restrictedCfg = {
      ...cfg,
      channels: {
        "wecom-kf": {
          ...(cfg.channels?.["wecom-kf"] as Record<string, unknown>),
          dmPolicy: "disabled",
        },
      },
    } as OpenClawConfig;

    await dispatchKfMessage({
      cfg: restrictedCfg,
      accountConfig: {
        ...createAccountConfig(),
        agent: { dm: { policy: "disabled" } },
      },
      msg: createTextMessage(),
      core: createRuntime(dispatchReplyWithBufferedBlockDispatcher),
      log,
    });

    expect(log).toHaveBeenCalledWith(expect.stringContaining("reason=dm_policy"));
    expect(log.mock.calls.flat().join(" ")).not.toContain("wx-user-1");
  });
});
