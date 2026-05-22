import { describe, expect, it, vi, beforeEach } from "vitest";
import { createChannelDispatch } from "./channel-dispatch.js";
import * as wireDispatch from "./wire-dispatch.js";
import * as embeddedDispatch from "./embedded-dispatch.js";
import * as subagentDispatch from "./subagent-dispatch.js";
import * as resolveRoute from "../bridge/resolve-channel-route.js";

describe("createChannelDispatch", () => {
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

  it("routes reply-pipeline to createWireDispatch", async () => {
    const wireResult = { ctx: {}, dispatcher: {}, replyOptions: {} };
    const spy = vi.spyOn(wireDispatch, "createWireDispatch").mockResolvedValue(wireResult as never);

    const result = await createChannelDispatch({ ...baseParams, mode: "reply-pipeline" });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ mode: "reply-pipeline", wireResult });
    spy.mockRestore();
  });

  it("routes embedded-agent to createEmbeddedAgentDispatch", async () => {
    const spy = vi
      .spyOn(embeddedDispatch, "createEmbeddedAgentDispatch")
      .mockResolvedValue({ runId: "r1", delivered: true });

    const result = await createChannelDispatch({ ...baseParams, mode: "embedded-agent" });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ mode: "embedded-agent", runId: "r1", delivered: true });
    spy.mockRestore();
  });

  it("routes subagent to createSubagentDispatch", async () => {
    const spy = vi
      .spyOn(subagentDispatch, "createSubagentDispatch")
      .mockResolvedValue({ runId: "r2", delivered: false });

    const result = await createChannelDispatch({
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
    const wireSpy = vi.spyOn(wireDispatch, "createWireDispatch").mockResolvedValue({
      ctx: {},
      dispatcher: {},
      replyOptions: {},
    } as never);

    await createChannelDispatch({ ...baseParams, mode: "reply-pipeline" });

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
