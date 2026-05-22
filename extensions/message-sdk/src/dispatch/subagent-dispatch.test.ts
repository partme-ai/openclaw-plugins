import { describe, expect, it, vi } from "vitest";
import { createSubagentDispatch } from "./subagent-dispatch.js";
import type { SubagentRuntime } from "./types.js";

describe("createSubagentDispatch", () => {
  it("runs subagent and delivers serialized wire when reply enabled", async () => {
    const deliver = vi.fn().mockResolvedValue(undefined);
    const run = vi.fn().mockResolvedValue({ runId: "run-1" });
    const waitForRun = vi.fn().mockResolvedValue({ text: "sub reply" });

    const runtime = {
      config: {},
      subagent: { run, waitForRun },
    } as unknown as SubagentRuntime;

    const result = await createSubagentDispatch({
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

    const result = await createSubagentDispatch({
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
