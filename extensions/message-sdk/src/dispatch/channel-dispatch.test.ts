/**
 * channel-dispatch.test.ts — 通道消息派发 facade，统一 Wire、Transcript、embedded-agent 与 subagent 路径。
 *
 * 这些测试锁定该模块的公开契约，防止命名、归一化、幂等或派发路径在重构时发生行为回退。
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { dispatchChannelMessage } from "./channel-dispatch.js";
import * as wireDispatch from "./wire-dispatch.js";
import * as embeddedDispatch from "./embedded-dispatch.js";
import * as subagentDispatch from "./subagent-dispatch.js";
import * as resolveRoute from "../bridge/resolve-channel-route.js";

describe("dispatchChannelMessage", () => {
  const baseParams = {
    runtime: {
      config: {},
      channel: {
        routing: { resolveAgentRoute: vi.fn() },
        reply: {},
      },
    } as never,
    channel: "rabbitmq",
    accountId: "default",
    peerId: "peer-1",
    text: "hello",
    reply: { deliver: vi.fn() },
  };

  beforeEach(() => {
    vi.spyOn(resolveRoute, "resolveChannelDispatchIdentity").mockResolvedValue({
      agentId: "main",
      sessionKey: "sk-1",
      route: { sessionKey: "sk-1", agentId: "main" },
    });
  });

  it("routes reply-pipeline to dispatchWireMessage", async () => {
    const wireResult = { ctx: {}, dispatcher: {}, replyOptions: {} };
    const spy = vi.spyOn(wireDispatch, "dispatchWireMessage").mockResolvedValue(wireResult as never);

    const result = await dispatchChannelMessage({ ...baseParams, mode: "reply-pipeline" });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ mode: "reply-pipeline", wireResult });
    spy.mockRestore();
  });

  it("routes embedded-agent to dispatchEmbeddedAgentMessage", async () => {
    const spy = vi
      .spyOn(embeddedDispatch, "dispatchEmbeddedAgentMessage")
      .mockResolvedValue({ runId: "r1", delivered: true });

    const result = await dispatchChannelMessage({ ...baseParams, mode: "embedded-agent" });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ mode: "embedded-agent", runId: "r1", delivered: true });
    spy.mockRestore();
  });

  it("routes subagent to dispatchSubagentMessage", async () => {
    const spy = vi
      .spyOn(subagentDispatch, "dispatchSubagentMessage")
      .mockResolvedValue({ runId: "r2", delivered: false });

    const result = await dispatchChannelMessage({
      ...baseParams,
      mode: "subagent",
      replyEnabled: true,
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ mode: "subagent", runId: "r2", delivered: false });
    spy.mockRestore();
  });

  it("auto-resolves sessionKey via resolveChannelDispatchIdentity when omitted", async () => {
    const identitySpy = vi.spyOn(resolveRoute, "resolveChannelDispatchIdentity").mockResolvedValue({
      agentId: "worker",
      sessionKey: "agent:worker:direct:p",
      route: {},
    });
    const wireSpy = vi.spyOn(wireDispatch, "dispatchWireMessage").mockResolvedValue({
      ctx: {},
      dispatcher: {},
      replyOptions: {},
    } as never);

    await dispatchChannelMessage({ ...baseParams, mode: "reply-pipeline" });

    expect(identitySpy).toHaveBeenCalled();
    expect(wireSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "worker",
        reply: expect.objectContaining({ sessionKey: "agent:worker:direct:p" }),
      }),
      undefined,
    );
    wireSpy.mockRestore();
  });
});
