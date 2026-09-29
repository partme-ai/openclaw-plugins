import { describe, expect, it, vi } from "vitest";
import { dispatchTranscriptTurn } from "./transcript-dispatch.js";

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
});
