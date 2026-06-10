/**
 * Webhook dispatch 超时回归测试：dispatch 永不 resolve 时 stream 仍应结束。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const withTimeoutMock = vi.hoisted(() => vi.fn());
const resolveWecomAgentReplyTimeoutMsMock = vi.hoisted(() => vi.fn(() => 50));
const createWecomReplyDispatcherMock = vi.hoisted(() => vi.fn());
const getMonitorStateMock = vi.hoisted(() => vi.fn());
const dispatchMock = vi.hoisted(() => vi.fn());

vi.mock("../shared/timeout.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../shared/timeout.js")>();
  return {
    ...actual,
    withTimeout: withTimeoutMock,
  };
});

vi.mock("../config/wecom-config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/wecom-config.js")>();
  return {
    ...actual,
    resolveWecomAgentReplyTimeoutMs: resolveWecomAgentReplyTimeoutMsMock,
  };
});

vi.mock("./reply-pipeline.js", () => ({
  createWecomReplyDispatcher: createWecomReplyDispatcherMock,
}));

vi.mock("./gateway.js", () => ({
  getMonitorState: getMonitorStateMock,
}));

vi.mock("./dedup.js", () => ({ claimWecomInboundMsgid: vi.fn(async () => true) }));
vi.mock("./access-policy.js", () => ({
  checkWebhookDmPolicy: vi.fn(async () => ({ allowed: true })),
  checkWebhookGroupPolicy: vi.fn(() => true),
}));
vi.mock("./command-auth.js", () => ({
  resolveWecomCommandAuthorization: vi.fn(async () => ({ commandAuthorized: true, shouldComputeAuth: false })),
  buildWecomUnauthorizedCommandPrompt: vi.fn(() => "unauthorized"),
}));
vi.mock("./inbound-helpers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./inbound-helpers.js")>();
  return {
    ...actual,
    processInboundMessage: vi.fn(async () => ({ body: "hello", media: undefined })),
    buildCfgForDispatch: vi.fn((cfg: unknown) => cfg),
    resolveWecomSenderUserId: vi.fn(() => "user1"),
  };
});
vi.mock("../config/dynamic-routing.js", () => ({
  processDynamicRouting: vi.fn(() => ({ routeModified: false, finalAgentId: "main", finalSessionKey: "sk" })),
}));
vi.mock("./active-reply.js", () => ({
  getActiveReplyUrl: vi.fn(() => undefined),
  pushFinalStreamReplyNow: vi.fn(async () => undefined),
}));
vi.mock("../config/streaming-config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/streaming-config.js")>();
  return {
    ...actual,
    resolveWecomStreamingConfig: vi.fn(() => ({ mode: "off" })),
  };
});

import { TimeoutError } from "../shared/timeout.js";
import { startAgentForStream } from "./monitor.js";

describe("startAgentForStream dispatch timeout", () => {
  const streamStore = {
    getStream: vi.fn(),
    updateStream: vi.fn(),
    markFinished: vi.fn(),
    onStreamFinished: vi.fn(),
    drainAckStreamsForBatch: vi.fn(() => []),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    streamStore.getStream.mockReturnValue({
      content: "",
      images: [],
      agentMediaKeys: [],
    });
    streamStore.updateStream.mockImplementation((_id: string, fn: (s: Record<string, unknown>) => void) => {
      const state = { content: "", finished: false };
      fn(state);
    });
    getMonitorStateMock.mockReturnValue({ streamStore });
    createWecomReplyDispatcherMock.mockReturnValue({
      dispatcherOptions: {},
      replyOptions: { disableBlockStreaming: false },
    });
    resolveWecomAgentReplyTimeoutMsMock.mockReturnValue(50);
    withTimeoutMock.mockImplementation(async () => {
      throw new TimeoutError("Agent reply timed out after 50ms");
    });
    dispatchMock.mockReturnValue(new Promise(() => undefined));
  });

  it("wraps dispatch in withTimeout and finishes stream on timeout", async () => {
    const core = {
      channel: {
        routing: {
          resolveAgentRoute: vi.fn(() => ({
            agentId: "main",
            sessionKey: "sk",
            accountId: "acc1",
            mainSessionKey: "main-sk",
          })),
        },
        session: {
          resolveStorePath: vi.fn(() => "/tmp/store"),
          readSessionUpdatedAt: vi.fn(() => undefined),
          recordInboundSession: vi.fn(async () => undefined),
        },
        reply: {
          resolveEnvelopeFormatOptions: vi.fn(() => ({})),
          formatAgentEnvelope: vi.fn((_opts: unknown) => "envelope"),
          finalizeInboundContext: vi.fn((ctx: unknown) => ctx),
          dispatchReplyWithBufferedBlockDispatcher: dispatchMock,
        },
        text: {
          resolveMarkdownTableMode: vi.fn(() => "off"),
        },
      },
    };

    await startAgentForStream({
      target: {
        account: { accountId: "acc1", config: {}, agent: { configured: false } },
        runtime: { log: vi.fn(), error: vi.fn() },
        statusSink: vi.fn(),
        core,
        config: {},
      } as never,
      accountId: "acc1",
      msg: {
        msgtype: "text",
        text: { content: "hi" },
        msgid: "m1",
        chattype: "single",
      } as never,
      streamId: "stream-timeout-1",
    });

    expect(withTimeoutMock).toHaveBeenCalledTimes(1);
    expect(withTimeoutMock.mock.calls[0]?.[1]).toBe(50);
    expect(streamStore.markFinished).toHaveBeenCalledWith("stream-timeout-1");
    expect(streamStore.onStreamFinished).toHaveBeenCalledWith("stream-timeout-1");
  });
});
