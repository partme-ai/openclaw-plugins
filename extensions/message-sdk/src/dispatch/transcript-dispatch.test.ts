import { describe, expect, it, vi } from "vitest";
import { createTranscriptDispatch } from "./transcript-dispatch.js";

describe("createTranscriptDispatch", () => {
  it("uses turn.runAssembled when session APIs are available", async () => {
    const recordInboundSession = vi.fn().mockResolvedValue(undefined);
    const dispatchReplyWithBufferedBlockDispatcher = vi.fn().mockResolvedValue(undefined);
    const runAssembled = vi.fn().mockResolvedValue(undefined);
    const deliver = vi.fn().mockResolvedValue(undefined);

    await createTranscriptDispatch({
      channelRuntime: {
        turn: { runAssembled },
        session: { recordInboundSession },
        reply: { dispatchReplyWithBufferedBlockDispatcher },
      },
      cfg: { session: { store: "/tmp/sessions.json" } },
      channel: "gotify",
      accountId: "default",
      agentId: "main",
      sessionKey: "agent:main:gotify:default:direct:4",
      storePath: "/tmp/sessions.json",
      inboundContext: { Body: "hello" },
      record: {
        updateLastRoute: {
          sessionKey: "agent:main:main",
          channel: "gotify",
          to: "gotify:4",
          accountId: "default",
        },
      },
      delivery: { deliver },
    });

    expect(runAssembled).toHaveBeenCalledTimes(1);
    expect(dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled();
    expect(recordInboundSession).not.toHaveBeenCalled();
  });

  it("falls back to record + dispatch when runAssembled is missing", async () => {
    const recordInboundSession = vi.fn().mockResolvedValue(undefined);
    const dispatchReplyWithBufferedBlockDispatcher = vi.fn().mockResolvedValue(undefined);
    const deliver = vi.fn().mockResolvedValue(undefined);

    await createTranscriptDispatch({
      channelRuntime: {
        session: { recordInboundSession },
        reply: { dispatchReplyWithBufferedBlockDispatcher },
      },
      cfg: {},
      channel: "gotify",
      accountId: "default",
      agentId: "main",
      sessionKey: "sk",
      storePath: "/tmp/sessions.json",
      inboundContext: { Body: "hello" },
      record: {},
      delivery: { deliver },
    });

    expect(recordInboundSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionKey: "sk", storePath: "/tmp/sessions.json" }),
    );
    expect(dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalledWith(
      expect.objectContaining({
        dispatcherOptions: expect.objectContaining({ deliver }),
      }),
    );
  });

  it("records inbound on runAssembled failure before rethrowing", async () => {
    const recordInboundSession = vi.fn().mockResolvedValue(undefined);
    const dispatchReplyWithBufferedBlockDispatcher = vi.fn();
    const runAssembled = vi.fn().mockRejectedValue(new Error("assembled failed"));
    const onRecordError = vi.fn();

    await expect(
      createTranscriptDispatch({
        channelRuntime: {
          turn: { runAssembled },
          session: { recordInboundSession },
          reply: { dispatchReplyWithBufferedBlockDispatcher },
        },
        cfg: {},
        channel: "gotify",
        accountId: "default",
        agentId: "main",
        sessionKey: "sk",
        storePath: "/tmp/sessions.json",
        inboundContext: { Body: "hello" },
        record: { onRecordError },
        delivery: { deliver: vi.fn() },
      }),
    ).rejects.toThrow("assembled failed");

    expect(recordInboundSession).toHaveBeenCalledTimes(1);
  });
});
