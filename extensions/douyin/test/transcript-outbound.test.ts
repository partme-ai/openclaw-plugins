/**
 * Douyin transcript route/context and outbound reply tests.
 */
import { describe, expect, it, vi } from "vitest";
import type { PluginRuntime } from "openclaw/plugin-sdk/core";

import {
  buildDouyinTranscriptInboundContext,
  resolveDouyinTranscriptRoute,
} from "../src/dispatch/transcript-dispatch.js";
import { deliverDouyinAgentReplyPayload } from "../src/dispatch/outbound-reply.js";
import { sendDouyinOutboundStub } from "../src/outbound.js";

function mockRuntime(overrides: Record<string, unknown> = {}): PluginRuntime {
  const resolveAgentRoute = vi.fn(() => ({
    sessionKey: "agent:main:douyin:direct:peer-1",
    agentId: "main",
    accountId: "default",
    mainSessionKey: "agent:main:main",
  }));

  return {
    config: {},
    channel: {
      routing: { resolveAgentRoute },
      session: {
        resolveStorePath: vi.fn(() => "/tmp/douyin-sessions"),
        readSessionUpdatedAt: vi.fn(() => 1_700_000_000_000),
      },
      reply: {
        resolveEnvelopeFormatOptions: vi.fn(() => ({ mode: "plain" })),
        formatAgentEnvelope: vi.fn(({ body }: { body: string }) => `[Douyin] ${body}`),
        finalizeInboundContext: vi.fn((ctx: Record<string, unknown>) => ({
          ...ctx,
          Finalized: true,
        })),
      },
      ...overrides,
    },
  } as unknown as PluginRuntime;
}

describe("resolveDouyinTranscriptRoute", () => {
  it("returns null when routing unavailable", () => {
    const runtime = { channel: {} } as PluginRuntime;
    expect(
      resolveDouyinTranscriptRoute({
        runtime,
        cfg: {},
        accountId: "default",
        peerId: "p1",
      }),
    ).toBeNull();
  });

  it("resolves session route and store path", () => {
    const runtime = mockRuntime();
    const resolved = resolveDouyinTranscriptRoute({
      runtime,
      cfg: { session: { store: "/data/sessions" } },
      accountId: "default",
      peerId: "peer-1",
      log: vi.fn(),
    });

    expect(resolved).not.toBeNull();
    expect(resolved!.route.sessionKey).toBe("agent:main:douyin:direct:peer-1");
    expect(resolved!.route.agentId).toBe("main");
    expect(resolved!.storePath).toBe("/tmp/douyin-sessions");
  });
});

describe("buildDouyinTranscriptInboundContext", () => {
  it("builds direct chat context with envelope formatting", () => {
    const runtime = mockRuntime();
    const ctx = buildDouyinTranscriptInboundContext({
      runtime,
      cfg: { session: { store: "/data/sessions" } },
      accountId: "default",
      peerId: "peer-1",
      shopId: "shop-1",
      rawText: "用户消息",
      messageSid: "sid-1",
      route: {
        sessionKey: "agent:main:douyin:direct:peer-1",
        agentId: "main",
        accountId: "default",
      },
      storePath: "/tmp/douyin-sessions",
    });

    expect(ctx.From).toBe("douyin:user:peer-1");
    expect(ctx.Provider).toBe("douyin");
    expect(ctx.ChatType).toBe("direct");
    expect(ctx.MessageSid).toBe("sid-1");
    expect(ctx.Finalized).toBe(true);
    expect(String(ctx.Body)).toContain("用户消息");
  });

  it("falls back to raw body when finalizeInboundContext missing", () => {
    const runtime = {
      channel: {
        routing: {
          resolveAgentRoute: vi.fn(),
        },
      },
    } as unknown as PluginRuntime;

    const ctx = buildDouyinTranscriptInboundContext({
      runtime,
      cfg: {},
      accountId: "default",
      peerId: "p2",
      shopId: "s2",
      rawText: "plain",
      route: { sessionKey: "sk", accountId: "default" },
    });

    expect(ctx.Body).toBe("plain");
    expect(ctx.RawBody).toBe("plain");
  });
});

describe("deliverDouyinAgentReplyPayload", () => {
  it("accepts text-only agent reply", async () => {
    const logs: string[] = [];
    const result = await deliverDouyinAgentReplyPayload({
      cfg: { channels: {} },
      shopId: "shop-1",
      peerId: "peer-1",
      text: "回复内容",
      log: (msg) => logs.push(msg),
    });

    expect(result.ok).toBe(true);
    expect(logs.some((l) => l.includes("出站文本"))).toBe(true);
  });

  it("rejects empty reply without media", async () => {
    const result = await deliverDouyinAgentReplyPayload({
      cfg: { channels: {} },
      shopId: "shop-1",
      peerId: "peer-1",
      text: "   ",
    });
    expect(result).toEqual({ ok: false, error: "empty agent reply" });
  });

  it("returns error when local media path does not exist", async () => {
    const result = await deliverDouyinAgentReplyPayload({
      cfg: { channels: {} },
      shopId: "shop-1",
      peerId: "peer-1",
      text: "MEDIA: /tmp/douyin-missing-file-xyz.png\n说明",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

describe("sendDouyinOutboundStub", () => {
  it("returns channel result with message id", async () => {
    const result = await sendDouyinOutboundStub("hello");
    expect(result.channel).toBe("douyin");
    expect(result.messageId).toMatch(/^douyin-outbound-stub-/);
  });
});
