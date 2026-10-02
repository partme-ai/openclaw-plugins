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
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDeliveryJournal } from "./delivery-journal.js";
import { createDeferredDeliveryAck } from "../ingress/deferred-delivery-ack.js";

describe("dispatchChannelMessage", () => {
  it("does not rerun an Agent after a durable visible delivery was settled", async () => {
    const dir = mkdtempSync(join(tmpdir(), "channel-journal-"));
    const old = process.env.OPENCLAW_STATE_DIR;
    process.env.OPENCLAW_STATE_DIR = dir;
    const spy = vi.spyOn(wireDispatch, "dispatchWireMessage").mockImplementation(async (params) => {
      await params.reply.deliver({ wire: "reply", text: "reply" });
      return { ctx: {}, dispatcher: {}, replyOptions: {}, deliveryOutcome: { kind: "delivered" } } as never;
    });
    try {
      const params = { ...baseParams, mode: "reply-pipeline" as const,
        deliveryIdentity: "cid-restart", requireDeliveryIdentity: true,
        extra: { dup: false, receivedAt: 1000 } };
      await dispatchChannelMessage(params);
      const again = await dispatchChannelMessage({ ...params, extra: { dup: true, receivedAt: 2000 } });
      expect(spy).toHaveBeenCalledOnce();
      expect(again.deliveryOutcome).toEqual({ kind: "delivered" });
    } finally {
      spy.mockRestore();
      if (old === undefined) delete process.env.OPENCLAW_STATE_DIR;
      else process.env.OPENCLAW_STATE_DIR = old;
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("rejects reuse of a settled delivery ID for a changed body or reply route", async () => {
    const dir = mkdtempSync(join(tmpdir(), "channel-journal-"));
    const old = process.env.OPENCLAW_STATE_DIR;
    process.env.OPENCLAW_STATE_DIR = dir;
    const spy = vi.spyOn(wireDispatch, "dispatchWireMessage").mockResolvedValue(
      { ctx: {}, dispatcher: {}, replyOptions: {}, deliveryOutcome: { kind: "no-reply" } } as never,
    );
    try {
      const params = { ...baseParams, deliveryIdentity: "cid-conflict", requireDeliveryIdentity: true,
        reply: { ...baseParams.reply, replyRoute: { topic: "reply-a" } } };
      await dispatchChannelMessage(params);
      await expect(dispatchChannelMessage({ ...params, text: "different" })).rejects.toThrow("Delivery identity conflict");
      await expect(dispatchChannelMessage({ ...params, reply: { ...params.reply, replyRoute: { topic: "reply-b" } } }))
        .rejects.toThrow("Delivery identity conflict");
      await expect(dispatchChannelMessage({ ...params, deliveryFingerprint: "different-source-bytes" }))
        .rejects.toThrow("Delivery identity conflict");
      expect(spy).toHaveBeenCalledOnce();
    } finally {
      spy.mockRestore();
      if (old === undefined) delete process.env.OPENCLAW_STATE_DIR;
      else process.env.OPENCLAW_STATE_DIR = old;
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("rejects reuse when extra changes the effective Agent context", async () => {
    const dir = mkdtempSync(join(tmpdir(), "channel-journal-"));
    const old = process.env.OPENCLAW_STATE_DIR;
    process.env.OPENCLAW_STATE_DIR = dir;
    const spy = vi.spyOn(wireDispatch, "dispatchWireMessage").mockResolvedValue(
      { ctx: {}, dispatcher: {}, replyOptions: {}, deliveryOutcome: { kind: "no-reply" } } as never,
    );
    try {
      const params = { ...baseParams, deliveryIdentity: "cid-extra-context", requireDeliveryIdentity: true,
        extra: { BodyForAgent: "first prompt", DesiredAgentId: "first-agent", receivedAt: 1000 } };
      await dispatchChannelMessage(params);
      await expect(dispatchChannelMessage({ ...params, extra: { ...params.extra, receivedAt: 2000 } }))
        .resolves.toMatchObject({ deliveryOutcome: { kind: "no-reply" } });
      await expect(dispatchChannelMessage({ ...params, extra: { DesiredAgentId: "first-agent", receivedAt: 3000, BodyForAgent: "first prompt" } }))
        .resolves.toMatchObject({ deliveryOutcome: { kind: "no-reply" } });
      await expect(dispatchChannelMessage({ ...params, extra: { ...params.extra, BodyForAgent: "second prompt" } }))
        .rejects.toThrow("Delivery identity conflict");
      await expect(dispatchChannelMessage({ ...params, extra: { ...params.extra, DesiredAgentId: "second-agent" } }))
        .rejects.toThrow("Delivery identity conflict");
      expect(spy).toHaveBeenCalledOnce();
    } finally {
      spy.mockRestore();
      if (old === undefined) delete process.env.OPENCLAW_STATE_DIR;
      else process.env.OPENCLAW_STATE_DIR = old;
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("replays a settled sender identity across a connection change without rerunning Agent", async () => {
    const dir = mkdtempSync(join(tmpdir(), "channel-journal-"));
    const old = process.env.OPENCLAW_STATE_DIR;
    process.env.OPENCLAW_STATE_DIR = dir;
    const spy = vi.spyOn(wireDispatch, "dispatchWireMessage").mockResolvedValue(
      { ctx: {}, dispatcher: {}, replyOptions: {}, deliveryOutcome: { kind: "no-reply" } } as never,
    );
    try {
      const stable = { peerId: "sender:alice", sessionKey: "sender:alice:agent:main", replyRoute: { destination: "/topic/agent/main/out" } };
      const first = { ...baseParams, channel: "stomp-tcp", deliveryIdentity: "sender:alice:request-1", requireDeliveryIdentity: true,
        peerId: "conn-1", sessionKey: "agent:main:direct:conn-1", reply: { ...baseParams.reply, replyRoute: { destination: "/topic/session.conn-1" } },
        deliveryFingerprintContext: stable };
      await dispatchChannelMessage(first);
      const replay = { ...first, peerId: "conn-2", sessionKey: "agent:main:direct:conn-2",
        reply: { ...first.reply, replyRoute: { destination: "/topic/session.conn-2" } } };
      await expect(dispatchChannelMessage(replay)).resolves.toMatchObject({ deliveryOutcome: { kind: "no-reply" } });
      await expect(dispatchChannelMessage({ ...replay, text: "different command" })).rejects.toThrow("Delivery identity conflict");
      expect(spy).toHaveBeenCalledOnce();
    } finally {
      spy.mockRestore();
      if (old === undefined) delete process.env.OPENCLAW_STATE_DIR;
      else process.env.OPENCLAW_STATE_DIR = old;
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("binds stable unified media content while ignoring retry timestamps", async () => {
    const dir = mkdtempSync(join(tmpdir(), "channel-journal-"));
    const old = process.env.OPENCLAW_STATE_DIR;
    process.env.OPENCLAW_STATE_DIR = dir;
    const spy = vi.spyOn(wireDispatch, "dispatchWireMessage").mockResolvedValue(
      { ctx: {}, dispatcher: {}, replyOptions: {}, deliveryOutcome: { kind: "no-reply" } } as never,
    );
    const message = { messageId: "m-1", traceId: "trace-1", timestamp: 1000,
      source: { channel: "rabbitmq", accountId: "default", userId: "peer-1", chatType: "direct" },
      contentType: "mixed", text: "hello", media: [{ url: "https://example.invalid/a", kind: "image", mimeType: "image/png" }],
      direction: "inbound" } as const;
    try {
      const params = { ...baseParams, deliveryIdentity: "cid-media", requireDeliveryIdentity: true,
        unified: message as never };
      await dispatchChannelMessage(params);
      await expect(dispatchChannelMessage({ ...params, unified: { ...message, timestamp: 2000, traceId: "trace-2" } as never }))
        .resolves.toMatchObject({ deliveryOutcome: { kind: "no-reply" } });
      await expect(dispatchChannelMessage({ ...params, unified: { ...message, media: [{ ...message.media[0], url: "https://example.invalid/b" }] } as never }))
        .rejects.toThrow("Delivery identity conflict");
      expect(spy).toHaveBeenCalledOnce();
    } finally {
      spy.mockRestore();
      if (old === undefined) delete process.env.OPENCLAW_STATE_DIR;
      else process.env.OPENCLAW_STATE_DIR = old;
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("blocks replay after a confirmed block followed by a failed final send", async () => {
    const dir = mkdtempSync(join(tmpdir(), "channel-journal-"));
    const old = process.env.OPENCLAW_STATE_DIR;
    process.env.OPENCLAW_STATE_DIR = dir;
    const spy = vi.spyOn(wireDispatch, "dispatchWireMessage").mockImplementation(async (params) => {
      await params.reply.deliver({ wire: "block" });
      throw new Error("final failed");
    });
    try {
      const params = { ...baseParams, mode: "reply-pipeline" as const,
        deliveryIdentity: "cid-partial", requireDeliveryIdentity: true };
      await expect(dispatchChannelMessage(params)).rejects.toMatchObject({
        cause: expect.objectContaining({ message: "final failed" }),
      });
      await expect(dispatchChannelMessage(params)).rejects.toThrow("Pending delivery reconciliation required");
      expect(spy).toHaveBeenCalledOnce();
    } finally {
      spy.mockRestore();
      if (old === undefined) delete process.env.OPENCLAW_STATE_DIR;
      else process.env.OPENCLAW_STATE_DIR = old;
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("holds a failed Agent run for reconciliation even when no reply send began", async () => {
    const dir = mkdtempSync(join(tmpdir(), "channel-journal-"));
    const old = process.env.OPENCLAW_STATE_DIR;
    process.env.OPENCLAW_STATE_DIR = dir;
    const spy = vi.spyOn(wireDispatch, "dispatchWireMessage").mockImplementation(async (params) => {
      params.beforeAgentDispatch?.();
      throw new Error("Agent tool failed");
    });
    try {
      const params = { ...baseParams, deliveryIdentity: "cid-tool", requireDeliveryIdentity: true };
      await expect(dispatchChannelMessage(params)).rejects.toMatchObject({
        cause: expect.objectContaining({ message: "Agent tool failed" }),
      });
      await expect(dispatchChannelMessage(params)).rejects.toThrow("Pending delivery reconciliation required");
      expect(spy).toHaveBeenCalledOnce();
    } finally {
      spy.mockRestore();
      if (old === undefined) delete process.env.OPENCLAW_STATE_DIR;
      else process.env.OPENCLAW_STATE_DIR = old;
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("reports a send failure after Agent start as uncertain and blocks redelivery", async () => {
    const dir = mkdtempSync(join(tmpdir(), "channel-journal-"));
    const old = process.env.OPENCLAW_STATE_DIR;
    process.env.OPENCLAW_STATE_DIR = dir;
    const spy = vi.spyOn(wireDispatch, "dispatchWireMessage").mockImplementation(async (params) => {
      params.beforeAgentDispatch?.();
      await params.reply.deliver({ wire: "reply" });
      throw new Error("unreachable");
    });
    try {
      const deliver = vi.fn().mockRejectedValue(new Error("publish failed"));
      const params = { ...baseParams, deliveryIdentity: "cid-send-failed", requireDeliveryIdentity: true,
        reply: { deliver } };
      await expect(dispatchChannelMessage(params)).rejects.toThrow("Pending delivery reconciliation required");
      await expect(dispatchChannelMessage(params)).rejects.toThrow("Pending delivery reconciliation required");
      expect(deliver).toHaveBeenCalledOnce();
      expect(spy).toHaveBeenCalledOnce();
    } finally {
      spy.mockRestore();
      if (old === undefined) delete process.env.OPENCLAW_STATE_DIR;
      else process.env.OPENCLAW_STATE_DIR = old;
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("quarantines a retryable receipt after Agent start because the turn cannot be safely rerun", async () => {
    const dir = mkdtempSync(join(tmpdir(), "channel-journal-"));
    const old = process.env.OPENCLAW_STATE_DIR;
    process.env.OPENCLAW_STATE_DIR = dir;
    const spy = vi.spyOn(wireDispatch, "dispatchWireMessage").mockImplementation(async (params) => {
      params.beforeAgentDispatch?.();
      return { ctx: {}, dispatcher: {}, replyOptions: {}, deliveryOutcome: { kind: "retryable" } } as never;
    });
    try {
      const params = { ...baseParams, deliveryIdentity: "cid-before-send", requireDeliveryIdentity: true };
      await expect(dispatchChannelMessage(params)).resolves.toMatchObject({ deliveryOutcome: { kind: "ambiguous" } });
      await expect(dispatchChannelMessage(params)).rejects.toThrow("Pending delivery reconciliation required");
      expect(spy).toHaveBeenCalledOnce();
    } finally {
      spy.mockRestore();
      if (old === undefined) delete process.env.OPENCLAW_STATE_DIR;
      else process.env.OPENCLAW_STATE_DIR = old;
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("does not settle a visible receipt without a confirmed channel send", async () => {
    const dir = mkdtempSync(join(tmpdir(), "channel-journal-"));
    const old = process.env.OPENCLAW_STATE_DIR;
    process.env.OPENCLAW_STATE_DIR = dir;
    const spy = vi.spyOn(wireDispatch, "dispatchWireMessage").mockImplementation(async (params) => {
      params.beforeAgentDispatch?.();
      return { ctx: {}, dispatcher: {}, replyOptions: {}, deliveryOutcome: { kind: "delivered" } } as never;
    });
    try {
      const params = { ...baseParams, deliveryIdentity: "cid-unconfirmed", requireDeliveryIdentity: true };
      await expect(dispatchChannelMessage(params)).resolves.toMatchObject({ deliveryOutcome: { kind: "ambiguous" } });
      await expect(dispatchChannelMessage(params)).rejects.toThrow("Pending delivery reconciliation required");
      expect(spy).toHaveBeenCalledOnce();
    } finally {
      spy.mockRestore();
      if (old === undefined) delete process.env.OPENCLAW_STATE_DIR;
      else process.env.OPENCLAW_STATE_DIR = old;
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("retries a route/preflight failure before Agent dispatch", async () => {
    const dir = mkdtempSync(join(tmpdir(), "channel-journal-"));
    const old = process.env.OPENCLAW_STATE_DIR;
    process.env.OPENCLAW_STATE_DIR = dir;
    const spy = vi.spyOn(wireDispatch, "dispatchWireMessage")
      .mockRejectedValueOnce(new Error("preflight failed"))
      .mockResolvedValueOnce({ ctx: {}, dispatcher: {}, replyOptions: {}, deliveryOutcome: { kind: "no-reply" } } as never);
    try {
      const params = { ...baseParams, deliveryIdentity: "cid-preflight", requireDeliveryIdentity: true };
      await expect(dispatchChannelMessage(params)).rejects.toThrow("preflight failed");
      await expect(dispatchChannelMessage(params)).resolves.toMatchObject({ deliveryOutcome: { kind: "no-reply" } });
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
      if (old === undefined) delete process.env.OPENCLAW_STATE_DIR;
      else process.env.OPENCLAW_STATE_DIR = old;
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("settles an embedded Agent's empty reply as no-reply", async () => {
    const spy = vi.spyOn(embeddedDispatch, "dispatchEmbeddedAgentMessage")
      .mockResolvedValue({ runId: "r-empty", delivered: false, outcome: "empty" });
    try {
      const result = await dispatchChannelMessage({ ...baseParams, mode: "embedded-agent" });
      expect(result.deliveryOutcome).toEqual({ kind: "no-reply" });
    } finally { spy.mockRestore(); }
  });
  it("holds an Embedded Agent's structured failure for reconciliation instead of committing no-reply", async () => {
    const dir = mkdtempSync(join(tmpdir(), "channel-journal-"));
    const old = process.env.OPENCLAW_STATE_DIR;
    process.env.OPENCLAW_STATE_DIR = dir;
    const runEmbeddedAgent = vi.fn(async () => ({ payloads: [], meta: { timeoutPhase: "provider" } }));
    try {
      const runtime = { ...baseParams.runtime, agent: {
        resolveAgentDir: vi.fn(async () => "/tmp/agent"),
        resolveAgentWorkspaceDir: vi.fn(() => "/tmp/ws"),
        runEmbeddedAgent,
      } } as never;
      const params = { ...baseParams, runtime, mode: "embedded-agent" as const,
        deliveryIdentity: "cid-embedded-timeout", requireDeliveryIdentity: true };
      await expect(dispatchChannelMessage(params)).resolves.toMatchObject({ deliveryOutcome: { kind: "ambiguous" } });
      await expect(dispatchChannelMessage(params)).rejects.toThrow("Pending delivery reconciliation required");
      expect(runEmbeddedAgent).toHaveBeenCalledOnce();
    } finally {
      if (old === undefined) delete process.env.OPENCLAW_STATE_DIR;
      else process.env.OPENCLAW_STATE_DIR = old;
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("keeps journal success uncommitted after broker NACK for an unobserved publisher", async () => {
    const dir = mkdtempSync(join(tmpdir(), "channel-journal-"));
    const old = process.env.OPENCLAW_STATE_DIR;
    process.env.OPENCLAW_STATE_DIR = dir;
    const spy = vi.spyOn(wireDispatch, "dispatchWireMessage").mockImplementation(async (params) => {
      params.beforeAgentDispatch?.();
      await params.reply.deliver({ wire: "reply" });
      return { ctx: {}, dispatcher: {}, replyOptions: {}, deliveryOutcome: { kind: "delivered" } } as never;
    });
    let settled = false;
    const delivery = { get settled() { return settled; }, ack: vi.fn(() => { settled = true; }),
      nack: vi.fn(() => { settled = true; }) };
    const deferred = createDeferredDeliveryAck({ delivery, requireReply: true });
    try {
      const params = { ...baseParams, deliveryIdentity: "cid-nack-no-commit", requireDeliveryIdentity: true,
        deferDeliverySettlement: true, canPrepareDeliverySettlement: () => deferred.wasReplyPublished(),
        reply: { deliver: vi.fn(async () => undefined) } };
      await expect(dispatchChannelMessage(params)).rejects.toThrow("Pending delivery reconciliation required");
      expect(deferred.finalizeAfterDispatch({ kind: "ambiguous" })).toBe(false);
      expect(delivery.nack).toHaveBeenCalledOnce();
      const journal = createDeliveryJournal(dir);
      expect(journal.inspect("rabbitmq", "default", "cid-nack-no-commit")?.status).not.toBe("delivered");
      journal.close();
      await expect(dispatchChannelMessage(params)).rejects.toThrow("Pending delivery reconciliation required");
    } finally {
      spy.mockRestore();
      if (old === undefined) delete process.env.OPENCLAW_STATE_DIR;
      else process.env.OPENCLAW_STATE_DIR = old;
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("commits a deferred journal outcome after broker ACK and suppresses replay", async () => {
    const dir = mkdtempSync(join(tmpdir(), "channel-journal-"));
    const old = process.env.OPENCLAW_STATE_DIR;
    process.env.OPENCLAW_STATE_DIR = dir;
    const spy = vi.spyOn(wireDispatch, "dispatchWireMessage").mockImplementation(async (params) => {
      params.beforeAgentDispatch?.();
      await params.reply.deliver({ wire: "reply" });
      return { ctx: {}, dispatcher: {}, replyOptions: {}, deliveryOutcome: { kind: "delivered" } } as never;
    });
    try {
      const params = { ...baseParams, deliveryIdentity: "cid-ack-commit", requireDeliveryIdentity: true,
        deferDeliverySettlement: true, canPrepareDeliverySettlement: () => true };
      const result = await dispatchChannelMessage(params);
      const journal = createDeliveryJournal(dir);
      expect(journal.inspect("rabbitmq", "default", "cid-ack-commit")?.status).toBe("ack-pending-delivered");
      result.confirmDelivery?.();
      expect(journal.inspect("rabbitmq", "default", "cid-ack-commit")?.status).toBe("delivered");
      journal.close();
      await expect(dispatchChannelMessage(params)).resolves.toMatchObject({ deliveryOutcome: { kind: "delivered" } });
      expect(spy).toHaveBeenCalledOnce();
    } finally {
      spy.mockRestore();
      if (old === undefined) delete process.env.OPENCLAW_STATE_DIR;
      else process.env.OPENCLAW_STATE_DIR = old;
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("ACKs a prepared redelivery after restart without rerunning Agent, then confirms the journal", async () => {
    const dir = mkdtempSync(join(tmpdir(), "channel-journal-"));
    const old = process.env.OPENCLAW_STATE_DIR;
    process.env.OPENCLAW_STATE_DIR = dir;
    const spy = vi.spyOn(wireDispatch, "dispatchWireMessage").mockImplementation(async (params) => {
      params.beforeAgentDispatch?.();
      await params.reply.deliver({ wire: "reply" });
      return { ctx: {}, dispatcher: {}, replyOptions: {}, deliveryOutcome: { kind: "delivered" } } as never;
    });
    try {
      const params = { ...baseParams, deliveryIdentity: "cid-prepared-retry", requireDeliveryIdentity: true,
        deferDeliverySettlement: true, canPrepareDeliverySettlement: () => true };
      await dispatchChannelMessage(params); // crash before the broker ACK is observed
      const replay = await dispatchChannelMessage(params);
      expect(replay).toMatchObject({ wireResult: { ctx: { skippedDuplicate: true } }, deliveryOutcome: { kind: "delivered" } });
      expect(spy).toHaveBeenCalledOnce();
      const journal = createDeliveryJournal(dir);
      expect(journal.inspect("rabbitmq", "default", "cid-prepared-retry")?.status).toBe("ack-pending-delivered");
      replay.confirmDelivery?.(); // RabbitMQ calls this only after ACK returns
      expect(journal.inspect("rabbitmq", "default", "cid-prepared-retry")?.status).toBe("delivered");
      journal.close();
    } finally {
      spy.mockRestore();
      if (old === undefined) delete process.env.OPENCLAW_STATE_DIR;
      else process.env.OPENCLAW_STATE_DIR = old;
      rmSync(dir, { recursive: true, force: true });
    }
  });
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
    const wireResult = { ctx: {}, dispatcher: {}, replyOptions: {}, deliveryOutcome: { kind: "delivered" } };
    const spy = vi.spyOn(wireDispatch, "dispatchWireMessage").mockResolvedValue(wireResult as never);

    const result = await dispatchChannelMessage({ ...baseParams, mode: "reply-pipeline" });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ mode: "reply-pipeline", wireResult, deliveryOutcome: { kind: "delivered" } });
    spy.mockRestore();
  });

  it("routes embedded-agent to dispatchEmbeddedAgentMessage", async () => {
    const spy = vi
      .spyOn(embeddedDispatch, "dispatchEmbeddedAgentMessage")
      .mockResolvedValue({ runId: "r1", delivered: true, outcome: "visible" });

    const result = await dispatchChannelMessage({ ...baseParams, mode: "embedded-agent" });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ mode: "embedded-agent", runId: "r1", delivered: true, outcome: "visible", deliveryOutcome: { kind: "delivered" } });
    spy.mockRestore();
  });

  it("routes subagent to dispatchSubagentMessage", async () => {
    const spy = vi
      .spyOn(subagentDispatch, "dispatchSubagentMessage")
      .mockResolvedValue({ runId: "r2", delivered: false, outcome: { kind: "failed", status: "timeout" } });

    const result = await dispatchChannelMessage({
      ...baseParams,
      mode: "subagent",
      replyEnabled: true,
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ mode: "subagent", runId: "r2", delivered: false, outcome: { kind: "failed", status: "timeout" }, deliveryOutcome: { kind: "retryable" } });
    spy.mockRestore();
  });
  it("settles a deliberately disabled subagent reply without publishing", async () => {
    const spy = vi.spyOn(subagentDispatch, "dispatchSubagentMessage")
      .mockResolvedValue({ runId: "r-disabled", delivered: false, outcome: { kind: "pending" } });
    const result = await dispatchChannelMessage({ ...baseParams, mode: "subagent", replyEnabled: false });
    expect(result.deliveryOutcome).toEqual({ kind: "no-reply" });
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
