/**
 * embedded-dispatch.test.ts — 通道消息派发 facade，统一 Wire、Transcript、embedded-agent 与 subagent 路径。
 *
 * 这些测试锁定该模块的公开契约，防止命名、归一化、幂等或派发路径在重构时发生行为回退。
 */

import { describe, expect, it, vi } from "vitest";
import { dispatchEmbeddedAgentMessage } from "./embedded-dispatch.js";
import type { EmbeddedAgentRuntime } from "./types.js";

describe("dispatchEmbeddedAgentMessage", () => {
  it("runs embedded agent and delivers serialized wire", async () => {
    const deliver = vi.fn().mockResolvedValue(undefined);
    const runEmbeddedAgent = vi.fn().mockResolvedValue({
      payloads: [{ text: "hello from agent" }],
      meta: { terminalReply: { disposition: "visible", text: "hello from agent" } },
    });

    const runtime = {
      config: { agents: {} },
      agent: {
        resolveAgentDir: vi.fn().mockResolvedValue("/tmp/agent"),
        resolveAgentWorkspaceDir: vi.fn().mockReturnValue("/tmp/ws"),
        runEmbeddedAgent,
      },
    } as unknown as EmbeddedAgentRuntime;

    const result = await dispatchEmbeddedAgentMessage({
      runtime,
      channel: "rabbitmq",
      accountId: "default",
      peerId: "device-1",
      text: "ping",
      agentId: "main",
      sessionKey: "sk-1",
      sessionId: "rabbitmq:default:main:device-1",
      timeoutMs: 5000,
      reply: { deliver },
    });

    expect(runEmbeddedAgent).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver.mock.calls[0][0].wire).toContain("hello from agent");
    expect(result.delivered).toBe(true);
    expect(result.runId).toBeTruthy();
  });

  it("skips deliver when agent returns empty text", async () => {
    const deliver = vi.fn();
    const runtime = {
      config: {},
      agent: {
        resolveAgentDir: vi.fn().mockResolvedValue("/tmp/agent"),
        resolveAgentWorkspaceDir: vi.fn().mockReturnValue("/tmp/ws"),
        runEmbeddedAgent: vi.fn().mockResolvedValue({ payloads: [], meta: { terminalReply: { disposition: "empty" } } }),
      },
    } as unknown as EmbeddedAgentRuntime;

    const result = await dispatchEmbeddedAgentMessage({
      runtime,
      channel: "rabbitmq",
      accountId: "default",
      peerId: "device-1",
      text: "ping",
      agentId: "main",
      sessionKey: "sk-1",
      reply: { deliver },
    });

    expect(deliver).not.toHaveBeenCalled();
    expect(result.delivered).toBe(false);
    expect(result.outcome).toBe("empty");
  });

  it.each([
    [{ payloads: [], meta: { error: { kind: "retry_limit", message: "failed" } } }, "failed"],
    [{ payloads: [], meta: { aborted: true } }, "failed"],
    [{ payloads: [], meta: { timeoutPhase: "provider" } }, "failed"],
    [{ payloads: [], meta: { continuationPending: true } }, "pending"],
    [{ payloads: [] }, "failed"],
    [{ payloads: [{ text: "unbound visible text" }] }, "failed"],
    [{ payloads: [], meta: { terminalReply: { disposition: "silent" } } }, "silent"],
  ] as const)("does not infer no-reply from empty payloads with structured terminal %j", async (agentResult, outcome) => {
    const deliver = vi.fn();
    const runtime = { config: {}, agent: {
      resolveAgentDir: vi.fn().mockResolvedValue("/tmp/agent"),
      resolveAgentWorkspaceDir: vi.fn().mockReturnValue("/tmp/ws"),
      runEmbeddedAgent: vi.fn().mockResolvedValue(agentResult),
    } } as unknown as EmbeddedAgentRuntime;
    const result = await dispatchEmbeddedAgentMessage({ runtime, channel: "rabbitmq", accountId: "default",
      peerId: "device-1", text: "ping", agentId: "main", sessionKey: "sk-1", reply: { deliver } });
    expect(result.outcome).toBe(outcome);
    expect(deliver).not.toHaveBeenCalled();
  });
});
