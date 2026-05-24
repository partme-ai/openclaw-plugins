/**
 * prepare 阶段：early thinking 早于媒体下载；queued 时 thinking 已在 prepare 完成。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const callOrder = vi.hoisted(() => [] as string[]);

const sendWecomEarlyThinkingMock = vi.hoisted(() =>
  vi.fn(async () => {
    callOrder.push("thinking");
    return true;
  }),
);

vi.mock("./ws-early-thinking.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ws-early-thinking.js")>();
  return {
    ...actual,
    createWecomEarlyThinkingStreamId: vi.fn(() => "stream-prepare-test"),
    sendWecomEarlyThinking: sendWecomEarlyThinkingMock,
    shouldSendWecomEarlyThinking: vi.fn(() => true),
  };
});

vi.mock("../media/media-handler.js", () => ({
  downloadAndSaveImages: vi.fn(async () => {
    callOrder.push("media-images");
    return [];
  }),
  downloadAndSaveFiles: vi.fn(async () => {
    callOrder.push("media-files");
    return [];
  }),
  MediaOversizeError: class MediaOversizeError extends Error {},
}));

vi.mock("../config/dm-policy.js", () => ({
  checkDmPolicy: vi.fn(async () => ({ allowed: true })),
}));

vi.mock("../config/group-policy.js", () => ({
  checkGroupPolicy: vi.fn(() => ({ allowed: true })),
}));

vi.mock("./ws-timing.js", () => ({
  createWsTimingContext: vi.fn(() => ({ t0: 0, accountId: "a", chatId: "c", msgIdSuffix: "m" })),
  logWsTimingStage: vi.fn(),
}));

import { _prepareWeComMessageForTest } from "./ws-monitor.js";
import {
  enqueueWeComChatTask,
  hasActiveTask,
  _resetChatQueueState,
} from "./chat-queue.js";

function buildTextFrame() {
  return {
    headers: { req_id: "req-1" },
    body: {
      msgid: "msg-text-001",
      msgtype: "text",
      chattype: "single",
      from: { userid: "user001" },
      text: { content: "hello" },
    },
  } as never;
}

function buildImageFrame() {
  return {
    headers: { req_id: "req-2" },
    body: {
      msgid: "msg-img-001",
      msgtype: "image",
      chattype: "single",
      from: { userid: "user001" },
      image: { url: "https://example.com/a.png", aeskey: "key" },
    },
  } as never;
}

describe("prepareWeComMessage early thinking order", () => {
  const account = {
    accountId: "default",
    sendThinkingMessage: true,
    config: {},
  } as never;

  const runtime = { log: vi.fn(), error: vi.fn() } as never;
  const config = {} as never;
  const wsClient = {} as never;

  beforeEach(() => {
    callOrder.length = 0;
    sendWecomEarlyThinkingMock.mockClear();
  });

  it("sends early thinking before media download for image messages", async () => {
    const entry = await _prepareWeComMessageForTest({
      frame: buildImageFrame(),
      account,
      config,
      runtime,
      wsClient,
    });

    expect(entry).not.toBeNull();
    expect(sendWecomEarlyThinkingMock).toHaveBeenCalledTimes(1);
    expect(callOrder.indexOf("thinking")).toBeLessThan(callOrder.indexOf("media-images"));
    expect(entry?.thinkingSentEarly).toBe(true);
    expect(entry?.streamId).toBe("stream-prepare-test");
  });

  it("sends early thinking for text-only without touching media download", async () => {
    const entry = await _prepareWeComMessageForTest({
      frame: buildTextFrame(),
      account,
      config,
      runtime,
      wsClient,
    });

    expect(entry).not.toBeNull();
    expect(sendWecomEarlyThinkingMock).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(["thinking"]);
    expect(entry?.thinkingSentEarly).toBe(true);
  });
});

describe("prepare thinking before queue wait", () => {
  beforeEach(() => {
    _resetChatQueueState();
    sendWecomEarlyThinkingMock.mockClear();
  });

  it("sets thinkingSentEarly during prepare while chat queue is busy", async () => {
    const account = {
      accountId: "default",
      sendThinkingMessage: true,
      config: {},
    } as never;
    const runtime = { log: vi.fn(), error: vi.fn() } as never;

    const gate = { open: false };
    enqueueWeComChatTask({
      accountId: "default",
      chatId: "user001",
      task: async () => {
        while (!gate.open) {
          await new Promise((r) => setTimeout(r, 5));
        }
      },
    });
    expect(hasActiveTask("default:user001")).toBe(true);

    const entry = await _prepareWeComMessageForTest({
      frame: buildTextFrame(),
      account,
      config: {} as never,
      runtime,
      wsClient: {} as never,
    });

    expect(entry?.thinkingSentEarly).toBe(true);
    expect(sendWecomEarlyThinkingMock).toHaveBeenCalledTimes(1);

    const { status } = enqueueWeComChatTask({
      accountId: "default",
      chatId: "user001",
      task: async () => undefined,
    });
    expect(status).toBe("queued");

    gate.open = true;
  });
});
