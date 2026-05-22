import { describe, expect, it, vi } from "vitest";
import { createWireDispatch } from "./wire-dispatch.js";
import * as inboundBridge from "../bridge/inbound-bridge.js";

describe("createWireDispatch", () => {
  it("delegates to dispatchInbound with identical params and result", async () => {
    const mockResult = {
      ctx: { text: "hello" },
      dispatcher: {},
      replyOptions: { agentId: "main" },
    };
    const dispatchInbound = vi
      .spyOn(inboundBridge, "dispatchInbound")
      .mockResolvedValue(mockResult as never);

    const params = {
      runtime: {} as never,
      channel: "mqtt",
      accountId: "default",
      peerId: "device-1",
      text: "hello",
      reply: { deliver: vi.fn() },
    };

    const result = await createWireDispatch(params);

    expect(dispatchInbound).toHaveBeenCalledTimes(1);
    expect(dispatchInbound).toHaveBeenCalledWith(params);
    expect(result).toBe(mockResult);

    dispatchInbound.mockRestore();
  });

  it("accepts optional wire config without changing behavior", async () => {
    const dispatchInbound = vi.spyOn(inboundBridge, "dispatchInbound").mockResolvedValue({
      ctx: {},
      dispatcher: {},
      replyOptions: {},
    } as never);

    await createWireDispatch(
      {
        runtime: {} as never,
        channel: "mqtt",
        accountId: "default",
        peerId: "peer",
        text: "x",
        reply: { deliver: vi.fn() },
      },
      { config: { channelClass: "wire" } },
    );

    expect(dispatchInbound).toHaveBeenCalledTimes(1);
    dispatchInbound.mockRestore();
  });
});
