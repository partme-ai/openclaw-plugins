import { describe, expect, it, vi } from "vitest";
import type { OpenClawConfig, PluginRuntime } from "openclaw/plugin-sdk";

import {
  applyInboundDialogueTransition,
  loadDialogueContext,
} from "./dialogue-session.js";
import { transitionState } from "./dialogue-transitions.js";
import { createDialogueContext } from "./dialogue-state.js";

function createMockRuntime(store: Record<string, unknown>): PluginRuntime {
  return {
    agent: {
      session: {
        resolveStorePath: () => "/tmp/sessions.json",
        loadSessionStore: () => store,
        updateSessionStore: vi.fn(async (_path, mutator) => {
          mutator(store);
        }),
      },
    },
  } as unknown as PluginRuntime;
}

const cfg = { session: { store: "/tmp/sessions.json" } } as OpenClawConfig;

describe("dialogue-session", () => {
  it("applyInboundDialogueTransition persists greeting after first user message", async () => {
    const store: Record<string, unknown> = {
      "session-1": { pluginExtensions: {} },
    };
    const runtime = createMockRuntime(store);

    const next = await applyInboundDialogueTransition({
      runtime,
      cfg,
      sessionKey: "session-1",
      agentId: "agent-1",
      userId: "wx-user-1",
      text: "你好，我想咨询价格",
    });

    expect(next.state).toBe("greeting");
    expect(next.turnCount).toBeGreaterThan(0);

    const loaded = await loadDialogueContext({
      runtime,
      cfg,
      sessionKey: "session-1",
      agentId: "agent-1",
      userId: "wx-user-1",
    });
    expect(loaded.state).toBe("greeting");
    expect(loaded.intent).toBeDefined();
  });

  it("transitionState matches unit expectations for human transfer", () => {
    const ctx = createDialogueContext({ sessionId: "s1", userId: "u1" });
    const afterGreeting = transitionState(ctx, { type: "user_message", text: "你好" });
    const afterTransfer = transitionState(afterGreeting, {
      type: "user_message",
      text: "转人工",
    });
    expect(afterTransfer.state).toBe("handing_off");
  });
});
