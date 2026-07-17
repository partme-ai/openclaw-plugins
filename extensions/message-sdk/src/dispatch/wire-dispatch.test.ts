/**
 * wire-dispatch.test.ts — 通道消息派发 facade，统一 Wire、Transcript、embedded-agent 与 subagent 路径。
 *
 * 这些测试锁定该模块的公开契约，防止命名、归一化、幂等或派发路径在重构时发生行为回退。
 */

import { describe, expect, it, vi } from "vitest";
import { buildTextMessage } from "../core/index.js";
import {
  InboundMessageQueue,
  InboundMessageQueueCapacityError,
} from "../queue/inbound-message-queue.js";
import { dispatchWireMessage } from "./wire-dispatch.js";
import * as inboundBridge from "../bridge/inbound-bridge.js";

describe("dispatchWireMessage", () => {
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

    const result = await dispatchWireMessage(params);

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

    await dispatchWireMessage(
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

  it("raises a retryable capacity error instead of marking a full queue as duplicate", async () => {
    const queue = new InboundMessageQueue({ maxSize: 1 });
    await queue.push({ message: buildTextMessage("mqtt", "default", "device", "queued") });
    const unified = buildTextMessage("mqtt", "default", "device", "new");

    await expect(
      dispatchWireMessage(
        {
          runtime: {} as never,
          channel: "mqtt",
          accountId: "default",
          peerId: "device",
          text: "new",
          unified,
          reply: { deliver: vi.fn() },
        },
        { useInboundQueue: true, inboundQueue: queue },
      ),
    ).rejects.toBeInstanceOf(InboundMessageQueueCapacityError);
  });
});
