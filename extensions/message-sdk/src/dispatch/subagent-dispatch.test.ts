/**
 * subagent-dispatch.test.ts — 通道消息派发 facade，统一 Wire、Transcript、embedded-agent 与 subagent 路径。
 *
 * 这些测试锁定该模块的公开契约，防止命名、归一化、幂等或派发路径在重构时发生行为回退。
 */

import { describe, expect, it, vi } from "vitest";
import { dispatchSubagentMessage } from "./subagent-dispatch.js";
import type { SubagentRuntime } from "./types.js";

describe("dispatchSubagentMessage", () => {
  it("runs subagent and delivers serialized wire when reply enabled", async () => {
    const deliver = vi.fn().mockResolvedValue(undefined);
    const run = vi.fn().mockResolvedValue({ runId: "run-1" });
    const waitForRun = vi.fn().mockResolvedValue({ text: "sub reply" });

    const runtime = {
      config: {},
      subagent: { run, waitForRun },
    } as unknown as SubagentRuntime;

    const result = await dispatchSubagentMessage({
      runtime,
      channel: "rabbitmq",
      accountId: "default",
      peerId: "device-1",
      text: "ping",
      agentId: "main",
      sessionKey: "sk-1",
      replyEnabled: true,
      reply: { deliver },
    });

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ message: "ping", deliver: false }),
    );
    expect(waitForRun).toHaveBeenCalledWith({ runId: "run-1", timeoutMs: 120_000 });
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(result.delivered).toBe(true);
  });

  it("does not wait or deliver when replyEnabled is false", async () => {
    const deliver = vi.fn();
    const waitForRun = vi.fn();
    const runtime = {
      config: {},
      subagent: {
        run: vi.fn().mockResolvedValue({ runId: "run-2" }),
        waitForRun,
      },
    } as unknown as SubagentRuntime;

    const result = await dispatchSubagentMessage({
      runtime,
      channel: "rabbitmq",
      accountId: "default",
      peerId: "device-1",
      text: "ping",
      agentId: "main",
      sessionKey: "sk-1",
      replyEnabled: false,
      reply: { deliver },
    });

    expect(waitForRun).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
    expect(result.delivered).toBe(false);
  });
});
