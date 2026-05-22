import { beforeEach, describe, expect, it, vi } from "vitest";

const getWeComRuntimeMock = vi.hoisted(() => vi.fn());
const getMonitorStateMock = vi.hoisted(() => vi.fn());

vi.mock("../runtime.js", () => ({ getWeComRuntime: getWeComRuntimeMock }));
vi.mock("./gateway.js", () => ({ getMonitorState: getMonitorStateMock }));
vi.mock("../runtime-api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../runtime-api.js")>();
  return {
    ...actual,
    createReplyPrefixContext: vi.fn(() => ({
      responsePrefix: "",
      responsePrefixContextProvider: vi.fn(),
      onModelSelected: vi.fn(),
    })),
    createChannelMessageReplyPipeline: vi.fn(() => ({ typingCallbacks: {} })),
    resolveSendableOutboundReplyParts: vi.fn((p) => p),
    formatReasoningMessage: vi.fn((t: string) => t),
  };
});
vi.mock("./active-reply.js", () => ({
  getActiveReplyUrl: vi.fn(),
  sendBotFallbackPromptNow: vi.fn(async () => undefined),
  useActiveReplyOnce: vi.fn(async () => undefined),
}));
vi.mock("./agent-dm.js", () => ({ agentDmMedia: vi.fn(async () => undefined) }));

import { createWecomReplyDispatcher, createWecomReplyPipeline } from "./reply-pipeline.js";

describe("createWecomReplyDispatcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getWeComRuntimeMock.mockReturnValue({
      channel: {
        reply: {
          resolveHumanDelayConfig: vi.fn(() => ({})),
        },
        text: { convertMarkdownTables: vi.fn((t: string) => t) },
        media: { fetchRemoteMedia: vi.fn() },
      },
    });
    getMonitorStateMock.mockReturnValue({
      streamStore: {
        getStream: vi.fn(() => ({
          content: "",
          images: [],
          agentMediaKeys: [],
          createdAt: Date.now(),
        })),
        updateStream: vi.fn(),
      },
    });
  });

  it("returns dispatcherOptions for dispatchReplyWithBufferedBlockDispatcher", () => {
    const result = createWecomReplyDispatcher({
      target: {
        account: { accountId: "acc1", agent: { configured: false } },
        runtime: { log: vi.fn(), error: vi.fn() },
        statusSink: vi.fn(),
        core: getWeComRuntimeMock(),
        config: {},
      } as never,
      streamId: "stream-1",
      chatType: "direct",
      rawBody: "hello",
      tableMode: "off",
      cfg: {} as never,
      agentId: "main",
    });

    expect(result.dispatcherOptions.deliver).toBeTypeOf("function");
    expect(result.dispatcherOptions.onError).toBeTypeOf("function");
    expect(result.replyOptions.disableBlockStreaming).toBe(false);
  });

  it("exports createWecomReplyPipeline as alias", () => {
    expect(createWecomReplyPipeline).toBe(createWecomReplyDispatcher);
  });

  it("preserves template_card / MEDIA / lifecycle hooks contract", () => {
    const result = createWecomReplyDispatcher({
      target: {
        account: { accountId: "acc1", agent: { configured: true } },
        runtime: { log: vi.fn(), error: vi.fn() },
        statusSink: vi.fn(),
        core: getWeComRuntimeMock(),
        config: {},
      } as never,
      streamId: "stream-features",
      chatType: "direct",
      rawBody: "MEDIA: /tmp/x.png",
      tableMode: "off",
      cfg: {} as never,
      agentId: "main",
    });
    expect(result.dispatcherOptions.onError).toBeTypeOf("function");
    expect(result.dispatcherOptions.onIdle).toBeTypeOf("function");
    expect(result.dispatcherOptions.onCleanup).toBeTypeOf("function");
  });
});
