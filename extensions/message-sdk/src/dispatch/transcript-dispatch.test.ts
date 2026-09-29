import { describe, expect, it, vi } from "vitest";
import { dispatchTranscriptTurn, TranscriptDispatchError } from "./transcript-dispatch.js";

const sessionKey = "agent:main:gotify:default:direct:4";

function makeTurn(dispatchReply: ReturnType<typeof vi.fn>, signal?: AbortSignal) {
  const deliver = vi.fn(async () => undefined);
  return {
    channelRuntime: {
      inbound: { dispatchReply },
      session: { recordInboundSession: vi.fn(async () => undefined) },
      reply: { dispatchReplyWithBufferedBlockDispatcher: vi.fn() },
    },
    cfg: { session: { store: "/tmp/sessions.json" } },
    channel: "gotify",
    accountId: "default",
    agentId: "main",
    sessionKey,
    storePath: "/tmp/sessions.json",
    inboundContext: { Body: "hello", SessionKey: sessionKey, MessageThreadId: "thread-7" },
    record: {
      updateLastRoute: {
        sessionKey,
        channel: "gotify",
        to: "gotify:4",
        accountId: "default",
        threadId: "thread-7",
      },
    },
    delivery: { deliver },
    signal,
  };
}

describe("dispatchTranscriptTurn", () => {
  it("uses the public inbound dispatcher once and returns its result with the same session and thread", async () => {
    const transcript: string[] = [];
    const result = { admission: { kind: "dispatch" }, dispatched: true, routeSessionKey: sessionKey, dispatchResult: { queuedFinal: false, counts: { tool: 0, block: 0, final: 1 } } };
    const dispatchReply = vi.fn(async (turn) => {
      transcript.push(turn.ctxPayload.Body);
      await turn.delivery.deliver({ text: "answer" });
      return result;
    });
    const turn = makeTurn(dispatchReply);

    expect(await dispatchTranscriptTurn(turn)).toBe(result);
    expect(dispatchReply).toHaveBeenCalledTimes(1);
    expect(dispatchReply).toHaveBeenCalledWith(expect.objectContaining({
      routeSessionKey: sessionKey,
      storePath: "/tmp/sessions.json",
      ctxPayload: expect.objectContaining({ SessionKey: sessionKey, MessageThreadId: "thread-7" }),
      record: expect.objectContaining({ updateLastRoute: expect.objectContaining({ threadId: "thread-7" }) }),
    }));
    expect(transcript).toEqual(["hello"]);
    expect(turn.channelRuntime.session.recordInboundSession).not.toHaveBeenCalled();
    expect(turn.channelRuntime.reply.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled();
    expect(turn.delivery.deliver).toHaveBeenCalledTimes(1);
  });

  it("never writes a second user turn when dispatch fails after recording", async () => {
    const transcript: string[] = [];
    const dispatchReply = vi.fn(async (turn) => {
      transcript.push(turn.ctxPayload.Body);
      throw new Error("dispatch failed after record");
    });
    const turn = makeTurn(dispatchReply);

    await expect(dispatchTranscriptTurn(turn)).rejects.toThrow("dispatch failed after record");
    expect(transcript).toEqual(["hello"]);
    expect(turn.channelRuntime.session.recordInboundSession).not.toHaveBeenCalled();
    expect(turn.delivery.deliver).not.toHaveBeenCalled();
  });

  it("does not deliver after cancellation while the host dispatcher is pending", async () => {
    const controller = new AbortController();
    const dispatchReply = vi.fn(async (turn) => {
      controller.abort();
      await turn.delivery.deliver({ text: "late reply" });
      return { admission: { kind: "dispatch" }, dispatched: true };
    });
    const turn = makeTurn(dispatchReply, controller.signal);

    await expect(dispatchTranscriptTurn(turn)).rejects.toMatchObject({ name: "AbortError" });
    expect(turn.delivery.deliver).not.toHaveBeenCalled();
  });

  it("passes cancellation to the running reply and leaves the host session retry defaults intact", async () => {
    const controller = new AbortController();
    let dispatchCalls = 0;
    const dispatchReply = vi.fn(async (turn) => {
      expect(turn.replyOptions?.abortSignal).toBe(controller.signal);
      expect(turn.sessionInitRetry).toBeUndefined();
      try {
        dispatchCalls += 1;
        throw new Error("session not initialized");
      } catch {
        dispatchCalls += 1;
        return { admission: { kind: "dispatch" }, dispatched: true };
      }
    });
    const turn = makeTurn(dispatchReply, controller.signal);

    await expect(dispatchTranscriptTurn(turn)).resolves.toMatchObject({ dispatched: true });
    expect(dispatchCalls).toBe(2);
  });

  it("aborts a reply already running inside the host", async () => {
    const controller = new AbortController();
    const dispatchReply = vi.fn(async (turn) => {
      await new Promise<void>((_resolve, reject) => {
        turn.replyOptions.abortSignal.addEventListener("abort", () => reject(new DOMException("stopped", "AbortError")), { once: true });
      });
    });
    const pending = dispatchTranscriptTurn(makeTurn(dispatchReply, controller.signal));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError", recordState: "not_started" });
  });

  it.each([
    ["not_started", false, false],
    ["recorded", true, false],
    ["ambiguous", true, true],
  ] as const)("labels a failed turn as %s", async (expected, invokeRecord, failRecord) => {
    const dispatchReply = vi.fn(async (turn) => {
      if (invokeRecord) {
        try {
          await turn.recordInboundSession({ storePath: turn.storePath, sessionKey: turn.routeSessionKey, ctx: turn.ctxPayload });
        } catch {
          // Host may surface its own error after the record callback failed.
        }
      }
      throw new Error("host failed");
    });
    const turn = makeTurn(dispatchReply);
    if (failRecord) {
      turn.channelRuntime.session.recordInboundSession.mockRejectedValueOnce(new Error("write uncertain"));
    }
    await expect(dispatchTranscriptTurn(turn)).rejects.toMatchObject({
      recordState: expected,
    } satisfies Partial<TranscriptDispatchError>);
  });

  it("does not report success when the host reports a reply error after recording", async () => {
    const dispatchReply = vi.fn(async (turn) => {
      await turn.recordInboundSession({ storePath: turn.storePath, sessionKey: turn.routeSessionKey, ctx: turn.ctxPayload, onRecordError: turn.record.onRecordError });
      turn.delivery.onError(new Error("reply pipeline failed"));
      return { admission: { kind: "dispatch" }, dispatched: true };
    });
    const turn = makeTurn(dispatchReply);
    await expect(dispatchTranscriptTurn(turn)).rejects.toMatchObject({ recordState: "recorded" });
  });

  it("does not report success when the host reports a record error", async () => {
    const dispatchReply = vi.fn(async (turn) => {
      await turn.recordInboundSession({ storePath: turn.storePath, sessionKey: turn.routeSessionKey, ctx: turn.ctxPayload, onRecordError: turn.record.onRecordError });
      return { admission: { kind: "dispatch" }, dispatched: true };
    });
    const turn = makeTurn(dispatchReply);
    turn.channelRuntime.session.recordInboundSession.mockImplementationOnce(async (recordParams) => {
      recordParams.onRecordError(new Error("record write uncertain"));
    });
    await expect(dispatchTranscriptTurn(turn)).rejects.toMatchObject({ recordState: "ambiguous" });
  });

  it("waits for a deferred metadata record error before accepting the turn", async () => {
    let metadataTaskFinished = false;
    const dispatchReply = vi.fn(async (turn) => {
      await turn.recordInboundSession({
        storePath: turn.storePath,
        sessionKey: turn.routeSessionKey,
        ctx: turn.ctxPayload,
        onRecordError: turn.record.onRecordError,
        trackSessionMetaTask: turn.record.trackSessionMetaTask,
      });
      return { admission: { kind: "dispatch" }, dispatched: true };
    });
    const turn = makeTurn(dispatchReply);
    turn.channelRuntime.session.recordInboundSession.mockImplementationOnce(async (recordParams) => {
      const task = Promise.resolve().then(() => {
        metadataTaskFinished = true;
        recordParams.onRecordError(new Error("metadata write uncertain"));
      });
      recordParams.trackSessionMetaTask(task);
    });
    await expect(dispatchTranscriptTurn(turn)).rejects.toMatchObject({ message: "metadata write uncertain", recordState: "ambiguous" });
    expect(metadataTaskFinished).toBe(true);
  });
});
