import { describe, it, expect, vi } from "vitest";

// Import the exported functions — buildMessage is now public.
import { deriveTraceId, generateMessageId, buildMessage, registerMessageBridge, validateBridgeConfig } from "../../src/bridge/message-bridge.js";

describe("deriveTraceId — 确定性追踪 ID", () => {
  it("same inputs always produce the same traceId", () => {
    const a = deriveTraceId("discord", "main", "assistant", "sess-abc123");
    const b = deriveTraceId("discord", "main", "assistant", "sess-abc123");
    expect(a).toBe(b);
  });

  it("different sessionKey produces different traceId", () => {
    const a = deriveTraceId("discord", "main", "assistant", "sess-abc123");
    const b = deriveTraceId("discord", "main", "assistant", "sess-xyz789");
    expect(a).not.toBe(b);
  });

  it("different channel produces different traceId", () => {
    const a = deriveTraceId("discord", "main", "assistant", "sess-abc");
    const b = deriveTraceId("slack", "main", "assistant", "sess-abc");
    expect(a).not.toBe(b);
  });

  it("different accountId produces different traceId", () => {
    const a = deriveTraceId("discord", "main", "assistant", "sess-abc");
    const b = deriveTraceId("discord", "ops", "assistant", "sess-abc");
    expect(a).not.toBe(b);
  });

  it("different agentId produces different traceId", () => {
    const a = deriveTraceId("discord", "main", "assistant", "sess-abc");
    const b = deriveTraceId("discord", "main", "gpt4-agent", "sess-abc");
    expect(a).not.toBe(b);
  });

  it("format is trace/{channel}/{accountId}/{agentId}/{digest}", () => {
    const id = deriveTraceId("telegram", "sales", "bot", "sess-xyz");
    expect(id).toMatch(/^trace\/telegram\/sales\/bot\/[a-z0-9]+$/);
  });

  it("digest portion is stable across 1000 calls", () => {
    const traceId = deriveTraceId("wecom", "main", "agent1", "sess-stable");
    const results = Array.from({ length: 1000 }, () => deriveTraceId("wecom", "main", "agent1", "sess-stable"));
    expect(new Set(results).size).toBe(1);
  });

  it("is deterministic regardless of call timing", () => {
    const id1 = deriveTraceId("irc", "default", "bot", "session-42");
    const id2 = deriveTraceId("irc", "default", "bot", "session-42");
    expect(id1).toBe(id2);
  });

  it("can be parsed by consumers to extract context", () => {
    const id = deriveTraceId("discord", "main", "gpt4", "sess-123");
    const parts = id.split("/");
    expect(parts[0]).toBe("trace");
    expect(parts[1]).toBe("discord");
    expect(parts[2]).toBe("main");
    expect(parts[3]).toBe("gpt4");
    expect(parts[4]).toBeTruthy();
  });

  it("sanitizes slashes in path segments", () => {
    const id = deriveTraceId("dingtalk-connector", "acct/prod", "agent/v2", "sess-123");
    // No raw slash inside segments — should be replaced with underscore
    const parts = id.split("/");
    expect(parts.length).toBe(5); // trace / channel / accountId / agentId / digest
    expect(parts[1]).toBe("dingtalk-connector");
    expect(parts[2]).toBe("acct_prod");
    expect(parts[3]).toBe("agent_v2");
  });
});

describe("generateMessageId — 唯一消息 ID", () => {
  it("encodes direction as 'in' for inbound", () => {
    const id = generateMessageId("discord", "main", "assistant", "inbound");
    expect(id).toMatch(/^bridge\/in\/discord\/main\/assistant\//);
  });

  it("encodes direction as 'out' for outbound", () => {
    const id = generateMessageId("slack", "ops", "bot", "outbound");
    expect(id).toMatch(/^bridge\/out\/slack\/ops\/bot\//);
  });

  it("each high-frequency call produces a unique messageId", () => {
    const ids = new Set(
      Array.from({ length: 10_000 }, () =>
        generateMessageId("test", "a", "agent", "inbound"),
      ),
    );
    expect(ids.size).toBe(10_000);
  });

  it("can be parsed to extract all context fields", () => {
    const id = generateMessageId("wecom", "sales", "bot1", "outbound");
    const parts = id.split("/");
    expect(parts[0]).toBe("bridge");
    expect(parts[1]).toBe("out");
    expect(parts[2]).toBe("wecom");
    expect(parts[3]).toBe("sales");
    expect(parts[4]).toBe("bot1");
  });

  it("sanitizes slashes in path segments", () => {
    const id = generateMessageId("ch/ann", "acc/t", "ag/id", "inbound");
    expect(id).not.toContain("ch/ann");
    expect(id).not.toContain("acc/t");
    expect(id).not.toContain("ag/id");
    expect(id).toMatch(/\/ch_ann\/acc_t\/ag_id\//);
  });
});

describe("buildMessage — UnifiedMessage 构建", () => {
  it("builds a valid UnifiedMessage with all required fields", () => {
    const msg = buildMessage({
      channel: "discord",
      accountId: "main",
      agentId: "assistant",
      sessionKey: "sess-u1",
      userId: "user123",
    });
    expect(msg.messageId).toMatch(/^bridge\//);
    expect(msg.traceId).toMatch(/^trace\//);
    expect(msg.timestamp).toBeGreaterThan(0);
    expect(msg.source.channel).toBe("discord");
    expect(msg.source.accountId).toBe("main");
    expect(msg.source.agentId).toBe("assistant");
    expect(msg.source.userId).toBe("user123");
    expect(msg.source.chatType).toBe("direct");
    expect(msg.contentType).toBe("text");
    expect(msg.text).toBe("");
    expect(msg.media).toEqual([]);
    expect(msg.direction).toBe("inbound");
  });

  it("defaults chatType to direct", () => {
    const msg = buildMessage({
      channel: "t", accountId: "a", agentId: "g", sessionKey: "s", userId: "u",
    });
    expect(msg.source.chatType).toBe("direct");
  });

  it("defaults direction to inbound", () => {
    const msg = buildMessage({
      channel: "t", accountId: "a", agentId: "g", sessionKey: "s", userId: "u",
    });
    expect(msg.direction).toBe("inbound");
    expect(msg.messageId).toMatch(/^bridge\/in\//);
  });

  it("includes metadata when provided", () => {
    const msg = buildMessage({
      channel: "t", accountId: "a", agentId: "g", sessionKey: "s", userId: "u",
      metadata: { sessionKey: "s1" },
    });
    expect(msg.metadata).toEqual({ sessionKey: "s1" });
  });

  it("supports all direction values with correct ID format", () => {
    const inbound = buildMessage({
      channel: "t", accountId: "a", agentId: "g", sessionKey: "s", userId: "u",
      direction: "inbound",
    });
    const outbound = buildMessage({
      channel: "t", accountId: "a", agentId: "g", sessionKey: "s", userId: "u",
      direction: "outbound",
    });
    expect(inbound.direction).toBe("inbound");
    expect(outbound.direction).toBe("outbound");
    expect(inbound.messageId).toMatch(/^bridge\/in\//);
    expect(outbound.messageId).toMatch(/^bridge\/out\//);
  });

  it("source includes agentId field", () => {
    const msg = buildMessage({
      channel: "telegram", accountId: "sales", agentId: "gpt4-agent",
      sessionKey: "s", userId: "u",
    });
    expect(msg.source.agentId).toBe("gpt4-agent");
  });

  it("traceId and messageId share channel/accountId/agentId context", () => {
    const msg = buildMessage({
      channel: "slack", accountId: "ops", agentId: "bot",
      sessionKey: "s1", userId: "u",
    });
    expect(msg.traceId).toMatch(/^trace\/slack\/ops\/bot\//);
    expect(msg.messageId).toMatch(/^bridge\/(in|out)\/slack\/ops\/bot\//);
  });

  it("sets text correctly when provided", () => {
    const msg = buildMessage({
      channel: "t", accountId: "a", agentId: "g", sessionKey: "s", userId: "u",
      text: "Hello world",
    });
    expect(msg.text).toBe("Hello world");
  });

  it("sets chatType to group when provided", () => {
    const msg = buildMessage({
      channel: "t", accountId: "a", agentId: "g", sessionKey: "s", userId: "u",
      chatType: "group",
    });
    expect(msg.source.chatType).toBe("group");
  });
});

describe("inbound/outbound traceId stability (全链路追踪)", () => {
  it("inbound and outbound for the same session share the same traceId", () => {
    const sessionKey = "sess-dm-zhangsan-20260521";
    const channel = "wecom";
    const accountId = "main";
    const agentId = "assistant";

    const inboundTraceId = deriveTraceId(channel, accountId, agentId, sessionKey);
    const outboundTraceId = deriveTraceId(channel, accountId, agentId, sessionKey);

    expect(inboundTraceId).toBe(outboundTraceId);
  });

  it("different sessions get different traceIds even on same channel/account/agent", () => {
    const session1 = deriveTraceId("discord", "main", "bot", "sess-userA");
    const session2 = deriveTraceId("discord", "main", "bot", "sess-userB");
    expect(session1).not.toBe(session2);
  });

  it("messageIds are unique within the same session (unlike traceId)", () => {
    const sessionKey = "sess-test";
    const channel = "slack";
    const accountId = "main";
    const agentId = "bot";

    const inboundMsg = buildMessage({
      channel, accountId, agentId, sessionKey, userId: "u",
      direction: "inbound", text: "hello",
    });
    const outboundMsg = buildMessage({
      channel, accountId, agentId, sessionKey, userId: "u",
      direction: "outbound", text: "response",
    });

    // messageIds must be different
    expect(inboundMsg.messageId).not.toBe(outboundMsg.messageId);
    // traceIds must be the same
    expect(inboundMsg.traceId).toBe(outboundMsg.traceId);
  });
});

function createBridgeHarness(overrides: Record<string, unknown> = {}, startService = true) {
  const hooks = new Map<string, (event: any, ctx: any) => void | Promise<void>>();
  let service: { start: (ctx: unknown) => void | Promise<void>; stop?: (ctx: unknown) => void | Promise<void> } | undefined;
  const sendText = vi.fn().mockResolvedValue({ channel: "mqtt", messageId: "ok" });
  const api = {
    pluginConfig: {
      channels: { discord: { mqChannel: "mqtt" } },
      delivery: { maxAttempts: 2, retryDelayMs: 1, publishTimeoutMs: 100, maxPayloadBytes: 10_000 },
      ...overrides,
    },
    runtime: {
      config: { current: vi.fn(() => ({})) },
      channel: { outbound: { loadAdapter: vi.fn().mockResolvedValue({ sendText }) } },
    },
    logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
    on: vi.fn((name: string, handler: (event: any, ctx: any) => void | Promise<void>) => hooks.set(name, handler)),
    registerService: vi.fn((registered: typeof service) => {
      service = registered;
    }),
  };
  registerMessageBridge(api as never);
  if (!service) throw new Error("bridge delivery service was not registered");
  if (startService) void service.start({});
  return { api, hooks, sendText, service };
}

describe("registerMessageBridge — OpenClaw 2026.7.1 public outbound contract", () => {
  it("scoped Hook Runtime can lazily start delivery without service.start", async () => {
    const { hooks, sendText } = createBridgeHarness({}, false);
    hooks.get("message_received")?.(
      { content: "lazy runtime", messageId: "source-lazy", from: "user-1" },
      { channelId: "discord", accountId: "main", sessionKey: "session-lazy" },
    );
    await vi.waitFor(() => expect(sendText).toHaveBeenCalledTimes(1));
  });

  it("publishes message_received through loadAdapter with an explicit direct topic target", async () => {
    const { hooks, sendText } = createBridgeHarness();
    await hooks.get("message_received")?.(
      { content: "hello", messageId: "source-1", from: "user-1", timestamp: 123 },
      { channelId: "discord", accountId: "main", sessionKey: "session-1", conversationId: "room-1" },
    );
    await vi.waitFor(() => expect(sendText).toHaveBeenCalledTimes(1));
    const context = sendText.mock.calls[0]?.[0];
    expect(context.to).toBe("openclaw-direct-topic:v1:openclaw%2Fbridge%2Fdiscord%2Finbound");
    expect(context.deliveryQueueId).toMatch(/^bridge\/in\/discord\//);
    const message = JSON.parse(context.text);
    expect(message).toMatchObject({ text: "hello", timestamp: 123, direction: "inbound" });
  });

  it("媒体消息即使没有文本也会镜像，并默认隐藏远程 URL", async () => {
    const { hooks, sendText } = createBridgeHarness();
    hooks.get("message_received")?.(
      {
        content: "",
        messageId: "media-only-1",
        from: "user-1",
        metadata: {
          mediaUrls: ["https://objects.example.test/photo.png?signature=secret"],
          mediaTypes: ["image/png"],
          guildId: "guild-1",
          channelName: "support",
        },
      },
      { channelId: "discord", accountId: "main", sessionKey: "session-media" },
    );
    await vi.waitFor(() => expect(sendText).toHaveBeenCalledTimes(1));
    const message = JSON.parse(sendText.mock.calls[0]?.[0].text);
    expect(message).toMatchObject({
      text: "",
      source: { chatType: "group" },
      media: [{ url: "", kind: "image", mimeType: "image/png" }],
      metadata: { mediaCount: 1, mediaUrlsIncluded: false, mediaTruncated: false },
    });
    expect(sendText.mock.calls[0]?.[0].text).not.toContain("signature=secret");
  });

  it("显式开启后只镜像安全的 HTTP(S) 媒体 URL", async () => {
    const { hooks, sendText } = createBridgeHarness({
      channels: { discord: { mqChannel: "mqtt", includeMediaUrls: true } },
    });
    hooks.get("message_received")?.(
      {
        content: "attachments",
        messageId: "media-url-1",
        metadata: {
          mediaUrls: [
            "https://cdn.example.test/image.png",
            "file:///private/tmp/secret.txt",
            "https://user:password@example.test/private.mp3",
          ],
          mediaTypes: ["image/png", "text/plain", "audio/mpeg"],
        },
      },
      { channelId: "discord", sessionKey: "session-media" },
    );
    await vi.waitFor(() => expect(sendText).toHaveBeenCalledTimes(1));
    const message = JSON.parse(sendText.mock.calls[0]?.[0].text);
    expect(message.media).toEqual([
      { url: "https://cdn.example.test/image.png", kind: "image", mimeType: "image/png" },
      { url: "", kind: "file", mimeType: "text/plain" },
      { url: "", kind: "audio", mimeType: "audio/mpeg" },
    ]);
    expect(message.metadata).toMatchObject({ mediaCount: 3, mediaUrlsIncluded: true, mediaTruncated: false });
  });

  it("媒体条目有界保留但报告原始总数与截断状态", async () => {
    const { hooks, sendText } = createBridgeHarness();
    hooks.get("message_received")?.(
      {
        content: "many attachments",
        messageId: "media-many",
        metadata: {
          mediaUrls: Array.from({ length: 20 }, (_, index) => `https://cdn.example.test/${index}.png`),
          mediaTypes: Array.from({ length: 20 }, () => "image/png"),
        },
      },
      { channelId: "discord", sessionKey: "session-media" },
    );
    await vi.waitFor(() => expect(sendText).toHaveBeenCalledTimes(1));
    const message = JSON.parse(sendText.mock.calls[0]?.[0].text);
    expect(message.media).toHaveLength(16);
    expect(message.metadata).toMatchObject({ mediaCount: 20, mediaTruncated: true });
  });

  it("publishes every successful message_sent payload with a distinct stable delivery id", async () => {
    const { hooks, sendText } = createBridgeHarness();
    const handler = hooks.get("message_sent");
    const ctx = { channelId: "discord", accountId: "main", sessionKey: "session-1", conversationId: "room-1" };
    await handler?.({ to: "room-1", content: "same", success: true, messageId: "sent-1" }, ctx);
    await handler?.({ to: "room-1", content: "same", success: true, messageId: "sent-2" }, ctx);
    await handler?.({ to: "room-1", content: "final", success: true, messageId: "sent-3" }, ctx);
    await vi.waitFor(() => expect(sendText).toHaveBeenCalledTimes(3));
    expect(new Set(sendText.mock.calls.map((call) => call[0].deliveryQueueId)).size).toBe(3);
    expect(sendText.mock.calls.map((call) => JSON.parse(call[0].text).text)).toEqual(["same", "same", "final"]);
  });

  it("does not mirror a failed source delivery as a successful outbound message", async () => {
    const { api, hooks, sendText } = createBridgeHarness();
    hooks.get("message_sent")?.(
      { to: "room-1", content: "not delivered", success: false, error: "platform unavailable" },
      { channelId: "discord", accountId: "main", sessionKey: "session-1" },
    );
    await Promise.resolve();
    expect(sendText).not.toHaveBeenCalled();
    expect(api.logger.warn).toHaveBeenCalledWith(expect.stringContaining("source delivery failed"));
  });

  it("does not recursively mirror its own audit topic when source and target are MQTT", async () => {
    const { hooks, sendText } = createBridgeHarness({
      channels: { mqtt: { mqChannel: "mqtt", topicPrefix: "openclaw/bridge/mqtt" } },
    });
    hooks.get("message_sent")?.(
      {
        to: "openclaw-direct-topic:v1:openclaw%2Fbridge%2Fmqtt%2Foutbound",
        content: "{\"metadata\":{\"bridge\":\"openclaw-bridge\"}}",
        success: true,
        messageId: "bridge-audit-send",
      },
      { channelId: "mqtt", accountId: "default", sessionKey: "session-1" },
    );
    await Promise.resolve();
    expect(sendText).not.toHaveBeenCalled();
  });

  it("awaits and retries broker failures instead of silently dropping", async () => {
    const { hooks, sendText } = createBridgeHarness();
    sendText.mockRejectedValueOnce(new Error("temporary")).mockResolvedValueOnce({ channel: "mqtt", messageId: "ok" });
    await hooks.get("message_received")?.(
      { content: "retry", messageId: "source-retry", from: "user-1" },
      { channelId: "discord", sessionKey: "session-1" },
    );
    await vi.waitFor(() => expect(sendText).toHaveBeenCalledTimes(2));
    expect(sendText.mock.calls[0]?.[0].deliveryQueueId).toBe(sendText.mock.calls[1]?.[0].deliveryQueueId);
  });

  it("脱敏来源 Channel 与目标 MQ adapter 的失败日志", async () => {
    const { api, hooks, sendText } = createBridgeHarness({
      delivery: { maxAttempts: 1, retryDelayMs: 1, publishTimeoutMs: 100, maxPayloadBytes: 10_000 },
    });
    const secret = "bridge-production-secret";
    hooks.get("message_sent")?.(
      { to: "room-1", content: "failed", success: false, error: `Authorization: Bearer ${secret}` },
      { channelId: "discord", sessionKey: "session-1" },
    );
    sendText.mockRejectedValueOnce(new Error(`mqtt://user:password@broker.local?access_token=${secret}`));
    hooks.get("message_received")?.(
      { content: "mirror", messageId: "source-secret" },
      { channelId: "discord", sessionKey: "session-1" },
    );
    await vi.waitFor(() => expect(api.logger.error).toHaveBeenCalledWith(expect.stringContaining("delivery failed")));

    const logs = JSON.stringify({ warn: api.logger.warn.mock.calls, error: api.logger.error.mock.calls });
    expect(logs).not.toMatch(/bridge-production-secret|user:password/);
    expect(logs).toContain("[REDACTED]");
  });

  it("fails fast for unsupported source or MQ channels", () => {
    expect(() => createBridgeHarness({ channels: { unknown: { mqChannel: "mqtt" } } })).toThrow("unsupported source channel");
    expect(() => createBridgeHarness({ channels: { discord: { mqChannel: "not-a-broker" } } })).toThrow("unsupported mqChannel");
  });

  it("Hook 只负责入队，不等待 Broker 网络请求", async () => {
    const { hooks, sendText } = createBridgeHarness();
    sendText.mockImplementation(() => new Promise(() => undefined));
    const result = hooks.get("message_received")?.(
      { content: "non-blocking", messageId: "source-non-blocking", from: "user-1" },
      { channelId: "discord", sessionKey: "session-1" },
    );
    expect(result).toBeUndefined();
    await vi.waitFor(() => expect(sendText).toHaveBeenCalledTimes(1));
  });

  it("有界队列满时拒绝新镜像并留下可观测错误", async () => {
    const { api, hooks, sendText } = createBridgeHarness({
      delivery: {
        maxAttempts: 1,
        retryDelayMs: 1,
        publishTimeoutMs: 100,
        maxPayloadBytes: 10_000,
        maxInFlight: 1,
        maxBufferedMessages: 1,
        shutdownTimeoutMs: 10,
      },
    });
    sendText.mockImplementation(() => new Promise(() => undefined));
    const handler = hooks.get("message_received");
    handler?.({ content: "one", messageId: "one" }, { channelId: "discord", sessionKey: "s" });
    handler?.({ content: "two", messageId: "two" }, { channelId: "discord", sessionKey: "s" });
    handler?.({ content: "three", messageId: "three" }, { channelId: "discord", sessionKey: "s" });
    await vi.waitFor(() => expect(sendText).toHaveBeenCalledTimes(1));
    expect(api.logger.error).toHaveBeenCalledWith(expect.stringContaining("delivery queue full"));
  });

  it("不同会话可并发，但同一 trace 的后一条消息不会越过前一条", async () => {
    let resolveFirst: ((value: { channel: string; messageId: string }) => void) | undefined;
    const { hooks, sendText } = createBridgeHarness({
      delivery: {
        maxAttempts: 1,
        retryDelayMs: 1,
        publishTimeoutMs: 100,
        maxPayloadBytes: 10_000,
        maxInFlight: 2,
        maxBufferedMessages: 10,
        shutdownTimeoutMs: 100,
      },
    });
    sendText
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveFirst = resolve;
      }))
      .mockResolvedValue({ channel: "mqtt", messageId: "ok" });
    const handler = hooks.get("message_received");
    handler?.({ content: "first", messageId: "first" }, { channelId: "discord", sessionKey: "same" });
    handler?.({ content: "second", messageId: "second" }, { channelId: "discord", sessionKey: "same" });
    handler?.({ content: "other", messageId: "other" }, { channelId: "discord", sessionKey: "other" });

    await vi.waitFor(() => expect(sendText).toHaveBeenCalledTimes(2));
    expect(sendText.mock.calls.map((call) => JSON.parse(call[0].text).text)).toEqual(["first", "other"]);
    resolveFirst?.({ channel: "mqtt", messageId: "ok" });
    await vi.waitFor(() => expect(sendText).toHaveBeenCalledTimes(3));
    expect(JSON.parse(sendText.mock.calls[2]?.[0].text).text).toBe("second");
  });

  it("停止时等待在途投递完成后再退出", async () => {
    let resolveSend: ((value: { channel: string; messageId: string }) => void) | undefined;
    const { hooks, sendText, service } = createBridgeHarness();
    sendText.mockImplementation(() => new Promise((resolve) => {
      resolveSend = resolve;
    }));
    hooks.get("message_received")?.(
      { content: "drain", messageId: "source-drain" },
      { channelId: "discord", sessionKey: "session-1" },
    );
    const stopping = service.stop?.({});
    let stopped = false;
    void Promise.resolve(stopping).then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    resolveSend?.({ channel: "mqtt", messageId: "ok" });
    await stopping;
    expect(stopped).toBe(true);
  });
});

describe("validateBridgeConfig — 运行时防御校验", () => {
  it("拒绝 Schema 外字段和隐式类型转换", () => {
    expect(() => validateBridgeConfig({ extra: true } as never)).toThrow("unknown config field");
    expect(() => validateBridgeConfig({ delivery: { maxAttempts: "3" } } as never)).toThrow("positive integer");
    expect(() => validateBridgeConfig({ channels: { discord: { enabled: "true" } } } as never)).toThrow("boolean");
    expect(() => validateBridgeConfig({ channels: { discord: { mystery: true } } } as never)).toThrow("unknown field");
    expect(() => validateBridgeConfig({ channels: { discord: { includeMediaUrls: "yes" } } } as never)).toThrow("boolean");
  });
});
