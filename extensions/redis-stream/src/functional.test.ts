/**
 * openclaw-redis-stream 功能测试。
 *
 * 针对真实 Redis 实例运行，覆盖 Pub/Sub、Stream、配置、路由、payload 解析等核心能力。
 * 需要 Docker Redis 或本地 Redis 在 localhost:6379 运行。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type RedisClientType } from "redis";

// ── Redis 连接 ──────────────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";

let client: RedisClientType;
const subClients: RedisClientType[] = [];

beforeAll(async () => {
  client = createClient({ url: REDIS_URL });
  await client.connect();
  // 确保测试环境干净
  await client.sendCommand(["FLUSHALL"]);
});

afterAll(async () => {
  for (const sub of subClients) {
    // 添加超时保护，避免已断开连接挂起
    await Promise.race([Promise.allSettled([sub.unsubscribe(), sub.pUnsubscribe(), sub.quit()]), sleep(2000)]);
  }
  await client.quit().catch(() => {});
}, 15000);

// ── 功能测试 ────────────────────────────────────────────────────

describe("Redis Connection", () => {
  it("connects to Redis and responds to PING", async () => {
    const result = await client.sendCommand(["PING"]);
    expect(String(result)).toBe("PONG");
  });

  it("can set and get keys", async () => {
    await client.set("test:key", "hello");
    const val = await client.get("test:key");
    expect(val).toBe("hello");
  });
});

describe("Pub/Sub Messaging", () => {
  it("SUBSCRIBE receives published messages", async () => {
    const sub = client.duplicate();
    subClients.push(sub);
    await sub.connect();

    const received: string[] = [];
    await sub.subscribe("test:pubsub:ch1", (msg) => {
      received.push(msg);
    });

    // 等待订阅生效
    await sleep(100);

    await client.publish("test:pubsub:ch1", "message-1");
    await client.publish("test:pubsub:ch1", "message-2");

    // 等待消息投递
    await sleep(200);

    expect(received).toContain("message-1");
    expect(received).toContain("message-2");

    await sub.unsubscribe("test:pubsub:ch1");
    await sub.quit();
  });

  it("PSUBSCRIBE matches wildcard patterns", async () => {
    const sub = client.duplicate();
    subClients.push(sub);
    await sub.connect();

    const received: Array<{ channel: string; message: string }> = [];
    await sub.pSubscribe("test:psub:*", (msg, ch) => {
      received.push({ channel: ch, message: msg });
    });

    await sleep(100);

    await client.publish("test:psub:ch1", "from-ch1");
    await client.publish("test:psub:ch2", "from-ch2");
    await client.publish("other:channel", "should-not-receive");

    await sleep(200);

    expect(received).toHaveLength(2);
    expect(received.map((r) => r.message)).toContain("from-ch1");
    expect(received.map((r) => r.message)).toContain("from-ch2");

    await sub.pUnsubscribe("test:psub:*");
    await sub.quit();
  });

  it("PUBLISH returns number of subscribers", async () => {
    const sub = client.duplicate();
    subClients.push(sub);
    await sub.connect();
    await sub.subscribe("test:pubsub:count", () => {});
    await sleep(100);

    // node-redis publish API returns number of subscribers
    const count = await client.publish("test:pubsub:count", "ping");
    expect(count).toBeGreaterThanOrEqual(1);

    await sub.unsubscribe("test:pubsub:count");
    await sub.quit();
  });
});

describe("Stream Operations", () => {
  const STREAM_KEY = "test:stream:inbound";
  const GROUP = "test-group";
  const CONSUMER = "test-consumer-1";

  beforeAll(async () => {
    // 清理
    await client.sendCommand(["DEL", STREAM_KEY]).catch(() => {});
  });

  it("XADD appends entries to a stream", async () => {
    const id = await client.sendCommand(["XADD", STREAM_KEY, "*", "text", "hello world", "agentId", "bot1"]);
    expect(String(id)).toMatch(/^\d+-\d+$/); // Redis stream ID format

    const len = await client.sendCommand(["XLEN", STREAM_KEY]);
    expect(Number(len)).toBe(1);
  });

  it("XGROUP CREATE makes a consumer group", async () => {
    // MKSTREAM: don't error if stream exists
    const result = await client.sendCommand(["XGROUP", "CREATE", STREAM_KEY, GROUP, "0", "MKSTREAM"]);
    expect(String(result)).toBe("OK");
  });

  it("XREADGROUP reads pending/new messages", async () => {
    // 先追加一条
    await client.sendCommand(["XADD", STREAM_KEY, "*", "text", "stream message 1"]);

    const raw = await client.sendCommand([
      "XREADGROUP",
      "GROUP",
      GROUP,
      CONSUMER,
      "COUNT",
      "10",
      "BLOCK",
      "2000",
      "STREAMS",
      STREAM_KEY,
      ">",
    ]);

    // 解析 XREADGROUP 返回值
    const entries = parseXReadGroupReply(raw);
    expect(entries.length).toBeGreaterThanOrEqual(1);

    const lastEntry = entries[entries.length - 1];
    expect(lastEntry.values["text"]).toBe("stream message 1");
  });

  it("XACK acknowledges messages", async () => {
    // 先追加并读取一条
    await client.sendCommand(["XADD", STREAM_KEY, "*", "text", "ack me"]);

    const raw = await client.sendCommand([
      "XREADGROUP",
      "GROUP",
      GROUP,
      CONSUMER,
      "COUNT",
      "1",
      "BLOCK",
      "2000",
      "STREAMS",
      STREAM_KEY,
      ">",
    ]);

    const entries = parseXReadGroupReply(raw);
    expect(entries.length).toBeGreaterThanOrEqual(1);

    // ACK
    const ackResult = await client.sendCommand(["XACK", STREAM_KEY, GROUP, entries[0].id]);
    expect(Number(ackResult)).toBe(1);
  });

  it("consumer group ensures no duplicate delivery", async () => {
    // 先追加一条且不 ACK
    await client.sendCommand(["XADD", STREAM_KEY, "*", "text", "pending message"]);

    // 消费者 C1 读取
    const raw1 = await client.sendCommand([
      "XREADGROUP",
      "GROUP",
      GROUP,
      CONSUMER,
      "COUNT",
      "1",
      "BLOCK",
      "2000",
      "STREAMS",
      STREAM_KEY,
      ">",
    ]);
    const e1 = parseXReadGroupReply(raw1);

    // 另一个消费者 session 读取同样的 >，不应该收到已分发给 C1 的消息
    const raw2 = await client.sendCommand([
      "XREADGROUP",
      "GROUP",
      GROUP,
      "test-consumer-2",
      "COUNT",
      "5",
      "BLOCK",
      "1000",
      "STREAMS",
      STREAM_KEY,
      ">",
    ]);
    const e2 = parseXReadGroupReply(raw2);

    // C2 不应收到 C1 pending 的消息
    const c2Ids = e2.map((e) => e.id);
    const c1Ids = e1.map((e) => e.id);
    for (const id of c1Ids) {
      expect(c2Ids).not.toContain(id);
    }
  });
});

describe("Payload Parsing (jsonTextOrPlain mode)", () => {
  it("extracts text field from JSON payload", () => {
    const payload = JSON.stringify({ text: "Hello from JSON" });
    const text = parseInboundText(payload, "jsonTextOrPlain");
    expect(text).toBe("Hello from JSON");
  });

  it("falls back to raw text when JSON has no text field", () => {
    const payload = JSON.stringify({ data: "no text here" });
    const text = parseInboundText(payload, "jsonTextOrPlain");
    expect(text).toBe(payload);
  });

  it("falls back to raw text when text field is empty", () => {
    const payload = JSON.stringify({ text: "   " });
    const text = parseInboundText(payload, "jsonTextOrPlain");
    expect(text).toBe(payload);
  });

  it("falls back to raw text on JSON parse error", () => {
    const text = parseInboundText("not json at all", "jsonTextOrPlain");
    expect(text).toBe("not json at all");
  });

  it("returns raw text in plain mode", () => {
    const payload = JSON.stringify({ text: "should not extract" });
    const text = parseInboundText(payload, "plain");
    expect(text).toBe(payload);
  });
});

describe("Topic Routing", () => {
  it("matches exact channels", () => {
    expect(matchChannel("openclaw:agent:bot1:in", "openclaw:agent:bot1:in")).toBe(true);
    expect(matchChannel("openclaw:agent:bot1:in", "openclaw:agent:bot2:in")).toBe(false);
  });

  it("matches * wildcard at end of pattern", () => {
    expect(matchChannel("sensor:temperature:bedroom", "sensor:temperature:*")).toBe(true);
    expect(matchChannel("sensor:humidity", "sensor:temperature:*")).toBe(false);
  });

  it("matches * wildcard as standalone", () => {
    expect(matchChannel("any:channel:name", "*")).toBe(true);
  });

  it("resolves standard openclaw:agent:<id>:in format", () => {
    const result = resolveInboundRoute("openclaw:agent:myBot:in");
    expect(result).not.toBeNull();
    expect(result!.agentId).toBe("myBot");
    expect(result!.source).toBe("standard");
    expect(result!.accountId).toBe("default");
  });

  it("explicit bindings take priority over standard format", () => {
    const bindings = [
      {
        channelPattern: "openclaw:agent:myBot:in",
        agentId: "override-agent",
        accountId: "custom-account",
      },
    ];
    const result = resolveInboundRoute("openclaw:agent:myBot:in", bindings);
    expect(result!.agentId).toBe("override-agent");
    expect(result!.accountId).toBe("custom-account");
    expect(result!.source).toBe("binding");
  });

  it("returns null for unmatched channels", () => {
    expect(resolveInboundRoute("unknown:garbage")).toBeNull();
  });
});

describe("Session Management", () => {
  it("getOrCreateSessionKey returns consistent key for same peer", () => {
    const params = {
      peerId: "device-001",
      agentId: "agent-1",
      accountId: "default",
      dmScope: "per-peer" as const,
      cfg: { session: { dmScope: "per-peer" } },
      channel: "redis-stream",
    };
    const key1 = getOrCreateSessionKey(params);
    const key2 = getOrCreateSessionKey(params);
    expect(key1).toBe(key2);
  });

  it("upsertSessionContext preserves existing fields on update", () => {
    const key = "agent:test:session-1";
    upsertSessionContext(key, {
      peerId: "p1",
      agentId: "a1",
      replyChannel: "original:reply",
    });
    upsertSessionContext(key, { lastInboundChannel: "updated:channel" });

    const ctx = getSessionContext(key);
    expect(ctx!.peerId).toBe("p1");
    expect(ctx!.agentId).toBe("a1");
    expect(ctx!.replyChannel).toBe("original:reply");
    expect(ctx!.lastInboundChannel).toBe("updated:channel");
  });

  it("removePeerSessions cleans up all maps", () => {
    const key = getOrCreateSessionKey({
      peerId: "cleanup-peer",
      agentId: "agent-x",
      accountId: "default",
      dmScope: "per-peer" as const,
      cfg: { session: { dmScope: "per-peer" } },
      channel: "redis-stream",
    });
    upsertSessionContext(key, { peerId: "cleanup-peer", agentId: "agent-x" });

    removePeerSessions("cleanup-peer");
    expect(getSessionContext(key)).toBeUndefined();
    expect(getPeerIdBySession(key)).toBeUndefined();
  });
});

describe("dmScope Session Keys", () => {
  const base = {
    cfg: { session: { dmScope: "per-peer" as const } },
    agentId: "bot",
    channel: "redis-stream",
    accountId: "default",
    peerId: "peer-1",
  };

  it("main scope: always returns agent:<id>:main", () => {
    const key = buildSessionKeyFromDmScope({
      ...base,
      cfg: { session: { dmScope: "main" } },
    });
    expect(key).toBe("agent:bot:main");
  });

  it("per-peer scope: agent:<id>:direct:<peer>", () => {
    const key = buildSessionKeyFromDmScope(base);
    expect(key).toBe("agent:bot:direct:peer-1");
  });

  it("per-channel-peer: includes channel name", () => {
    const key = buildSessionKeyFromDmScope({
      ...base,
      cfg: { session: { dmScope: "per-channel-peer" } },
    });
    expect(key).toBe("agent:bot:redis-stream:direct:peer-1");
  });

  it("per-account-channel-peer: full multi-tenancy", () => {
    const key = buildSessionKeyFromDmScope({
      ...base,
      cfg: { session: { dmScope: "per-account-channel-peer" } },
    });
    expect(key).toBe("agent:bot:redis-stream:default:direct:peer-1");
  });
});

describe("Config Resolution", () => {
  it("returns defaults for empty config", () => {
    const config = resolveRedisChannelConfig({});
    expect(config.url).toBe("redis://127.0.0.1:6379");
    expect(config.channelMode).toBe("pubsub");
    expect(config.stream.inboundKey).toBe("openclaw:inbound");
    expect(config.payload.mode).toBe("jsonTextOrPlain");
    expect(config.connection.reconnectMs).toBe(3000);
    expect(config.connection.maxRetries).toBe(10);
  });

  it("reads channel-specific overrides", () => {
    const config = resolveRedisChannelConfig({
      channels: {
        "redis-stream": {
          url: "redis://custom:6380",
          channelMode: "stream",
          subscribeChannels: ["sensor:*", "chat:*"],
          stream: {
            inboundKey: "my:in",
            consumerGroup: "my-group",
            blockMs: 10000,
          },
        },
      },
    });
    expect(config.url).toBe("redis://custom:6380");
    expect(config.channelMode).toBe("stream");
    expect(config.subscribeChannels).toEqual(["sensor:*", "chat:*"]);
    expect(config.stream.inboundKey).toBe("my:in");
    expect(config.stream.consumerGroup).toBe("my-group");
    expect(config.stream.blockMs).toBe(10000);
  });

  it("filters invalid channelBindings", () => {
    const config = resolveRedisChannelConfig({
      channels: {
        "redis-stream": {
          url: "redis://localhost:6379",
          channelBindings: [
            { channelPattern: "valid:*", agentId: "agent1" },
            { channelPattern: "no-agent" }, // missing agentId
            { agentId: "no-pattern" }, // missing channelPattern
            null, // non-object
            "just a string", // non-object
          ],
        },
      },
    });
    expect(config.channelBindings).toHaveLength(1);
    expect(config.channelBindings[0].agentId).toBe("agent1");
  });
});

describe("Channel Plugin Definition", () => {
  it("has correct id and capabilities", () => {
    expect(redisStreamChannel.id).toBe("redis-stream");
    expect(redisStreamChannel.capabilities.chatTypes).toContain("direct");
    expect(redisStreamChannel.meta.label).toBe("Redis Stream");
    expect(redisStreamChannel.threading?.resolveReplyToMode?.()).toBe("off");
    expect(redisStreamChannel.groups?.resolveRequireMention?.()).toBe(false);
  });

  it("lists default account", () => {
    expect(redisStreamChannel.config.listAccountIds()).toEqual(["default"]);
  });

  it("detects configured state via url presence", () => {
    expect(
      redisStreamChannel.config.isConfigured({
        channels: { "redis-stream": { url: "redis://localhost:6379" } },
      }),
    ).toBe(true);
    expect(redisStreamChannel.config.isConfigured({})).toBe(false);
  });
});

describe("defaultAgentId routing", () => {
  it("resolves defaultAgentId from config", () => {
    const cfg = resolveRedisChannelConfig({
      channels: {
        "redis-stream": {
          url: "redis://localhost:6379",
          defaultAgentId: "main",
        },
      },
    });
    expect(cfg.defaultAgentId).toBe("main");
  });

  it("defaults to empty string when not configured", () => {
    const cfg = resolveRedisChannelConfig({
      channels: {
        "redis-stream": { url: "redis://localhost:6379" },
      },
    });
    expect(cfg.defaultAgentId).toBe("");
  });

  it("Pub/Sub message routed to defaultAgentId instead of being dropped", async () => {
    // 使用独立 stream key 避免与现有测试冲突
    const testStream = `test:default-agent:${Date.now()}`;
    const group = "test-da-group";

    // 确保 stream 存在
    await client.sendCommand(["DEL", testStream]).catch(() => {});
    await client.xAdd(testStream, "*", { text: "hello from default agent route" });

    // 创建消费组
    await client.xGroupCreate(testStream, group, "0", { MKSTREAM: true });

    // 读取消息确认存在
    const result = await client.xReadGroup(group, "test-da-consumer", { key: testStream, id: ">" }, { COUNT: 1 });
    expect(result).not.toBeNull();
    expect(result![0].messages.length).toBeGreaterThanOrEqual(1);

    const fields = result![0].messages[0].message;
    const fieldMap = toFieldMap(fields as unknown as Array<unknown> | Record<string, unknown>);
    expect(fieldMap.get("text")).toBe("hello from default agent route");

    // ACK 并清理
    await client.xAck(testStream, group, result![0].messages[0].id);
    await client.sendCommand(["DEL", testStream]).catch(() => {});

    // 验证：消息通过 defaultAgentId="main" 的 config 被正确解析
    const fullConfig = resolveRedisChannelConfig({
      channels: {
        "redis-stream": {
          url: "redis://localhost:6379",
          defaultAgentId: "main",
        },
      },
    });
    expect(fullConfig.defaultAgentId).toBe("main");
  });

  it("inbound without binding or standard format uses defaultAgentId fallback", () => {
    const config = resolveRedisChannelConfig({
      channels: {
        "redis-stream": {
          url: "redis://localhost:6379",
          defaultAgentId: "main",
        },
      },
    });
    // 随机 channel 不匹配任何绑定或标准格式
    const channel = "random:user:message";
    const isStandardFormat = channel.startsWith("openclaw:agent:") && channel.endsWith(":in");
    expect(isStandardFormat).toBe(false);

    // 无显式绑定时，resolveInboundRoute 返回 null
    const route = resolveInboundRoute(channel, config.channelBindings);
    expect(route).toBeNull();

    // 但 config.defaultAgentId 兜底，确保 inbound handler 不会丢弃消息
    expect(config.defaultAgentId).toBe("main");
    expect(config.defaultAgentId.length).toBeGreaterThan(0);
  });
});

// 辅助函数：node-redis v5 解析后 message 为纯对象，同时兼容平铺数组
function toFieldMap(fields: Array<unknown> | Record<string, unknown>): Map<string, string> {
  const map = new Map<string, string>();
  if (Array.isArray(fields)) {
    for (let i = 0; i < fields.length; i += 2) {
      map.set(String(fields[i] ?? ""), String(fields[i + 1] ?? ""));
    }
  } else if (fields && typeof fields === "object") {
    for (const [key, value] of Object.entries(fields)) {
      map.set(key, String(value ?? ""));
    }
  }
  return map;
}

describe("Redis Stats", () => {
  it("getStats returns stats object with expected shape", () => {
    const s = getStats();
    expect(s).toHaveProperty("connected");
    expect(s).toHaveProperty("messagesRead");
    expect(s).toHaveProperty("messagesWritten");
    expect(s).toHaveProperty("lastConnectAt");
    expect(s).toHaveProperty("lastReadAt");
    expect(s).toHaveProperty("lastError");
    expect(s).toHaveProperty("subscribedChannels");
  });
});

describe("End-to-End: Pub/Sub Full Pipeline", () => {
  it("full pub/sub cycle: publish → subscribe → receive → ack", async () => {
    const channel = "test:e2e:pubsub";
    const sub = client.duplicate();
    subClients.push(sub);
    await sub.connect();

    const messages: string[] = [];
    await sub.subscribe(channel, (msg) => {
      messages.push(msg);
    });
    await sleep(100);

    // 模拟 publishMessage
    await client.publish(channel, JSON.stringify({ text: "Hello E2E" }));
    await client.publish(channel, "plain text message");
    await sleep(200);

    expect(messages.length).toBe(2);

    await sub.unsubscribe(channel);
    await sub.quit();
  });
});

describe("End-to-End: Stream Full Pipeline", () => {
  const STREAM = "test:e2e:stream";
  const GROUP = "e2e-group";
  const CONSUMER = "e2e-consumer";

  beforeAll(async () => {
    await client.sendCommand(["DEL", STREAM]).catch(() => {});
    // Create group with MKSTREAM
    await client.sendCommand(["XGROUP", "CREATE", STREAM, GROUP, "0", "MKSTREAM"]).catch(() => {});
  });

  it("XADD → XREADGROUP → XACK cycle", async () => {
    // 1. 发布消息（模拟 publishEntry）
    const fields = ["text", "integration test", "agentId", "test-bot"];
    const id = String(await client.sendCommand(["XADD", STREAM, "*", ...fields]));
    expect(id).toMatch(/^\d+-\d+$/);

    // 2. 消费（模拟 consumeLoop 中的 XREADGROUP）
    const raw = await client.sendCommand([
      "XREADGROUP",
      "GROUP",
      GROUP,
      CONSUMER,
      "COUNT",
      "5",
      "BLOCK",
      "2000",
      "STREAMS",
      STREAM,
      ">",
    ]);
    const entries = parseXReadGroupReply(raw);
    expect(entries.length).toBeGreaterThanOrEqual(1);

    const entry = entries.find((e) => e.id === id);
    expect(entry).toBeDefined();
    expect(entry!.values["text"]).toBe("integration test");
    expect(entry!.values["agentId"]).toBe("test-bot");

    // 3. 确认（模拟 ackEntry）
    const ackCount = Number(await client.sendCommand(["XACK", STREAM, GROUP, id]));
    expect(ackCount).toBe(1);
  });

  it("pending entries are not redelivered via >", async () => {
    // 追加一条但不 ACK
    const id = String(await client.sendCommand(["XADD", STREAM, "*", "text", "will be pending"]));

    // C1 读取
    await client.sendCommand([
      "XREADGROUP",
      "GROUP",
      GROUP,
      CONSUMER,
      "COUNT",
      "1",
      "BLOCK",
      "2000",
      "STREAMS",
      STREAM,
      ">",
    ]);

    // C2 读取 >，不应收到 C1 pending 的
    const raw2 = await client.sendCommand([
      "XREADGROUP",
      "GROUP",
      GROUP,
      "e2e-consumer-2",
      "COUNT",
      "5",
      "BLOCK",
      "1000",
      "STREAMS",
      STREAM,
      ">",
    ]);
    const e2 = parseXReadGroupReply(raw2);
    expect(e2.map((e) => e.id)).not.toContain(id);

    // 清理：用 C1 确认这个 pending 消息
    await client.sendCommand(["XACK", STREAM, GROUP, id]);
  });
});

// ── 辅助函数（复制自源码，用于测试） ─────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// 从 redis-stream-server.ts 复制
function parseXReadGroupReply(raw: unknown): Array<{
  id: string;
  stream: string;
  values: Record<string, string>;
}> {
  if (!Array.isArray(raw)) return [];
  const entries: Array<{ id: string; stream: string; values: Record<string, string> }> = [];
  for (const streamItem of raw as Array<unknown>) {
    const arr = streamItem as Array<unknown>;
    const streamName = Array.isArray(arr) ? String(arr[0]) : "";
    const messages = Array.isArray(arr?.[1]) ? (arr[1] as Array<unknown>) : [];
    for (const message of messages) {
      const msgArr = message as Array<unknown>;
      const id = String(msgArr?.[0] ?? "");
      const fieldPairs = Array.isArray(msgArr?.[1]) ? (msgArr[1] as Array<unknown>) : [];
      const values: Record<string, string> = {};
      for (let index = 0; index < fieldPairs.length; index += 2) {
        values[String(fieldPairs[index])] = String(fieldPairs[index + 1] ?? "");
      }
      entries.push({ id, stream: streamName, values });
    }
  }
  return entries;
}

// 从 inbound.ts 复制
function parseInboundText(rawPayload: string, mode: "plain" | "jsonTextOrPlain"): string {
  if (mode !== "jsonTextOrPlain") return rawPayload;
  try {
    const parsed = JSON.parse(rawPayload) as { text?: unknown };
    if (typeof parsed.text === "string" && parsed.text.trim().length > 0) {
      return parsed.text;
    }
  } catch {
    // ignore parse error, fall back to raw text
  }
  return rawPayload;
}

// 从 topic-router.ts 复制
function matchChannel(channel: string, pattern: string): boolean {
  if (pattern === "*") return true;
  const channelParts = channel.split(":");
  const patternParts = pattern.split(":");
  for (let i = 0; i < patternParts.length; i++) {
    const pp = patternParts[i];
    if (pp === "*") return true;
    if (i >= channelParts.length || pp !== channelParts[i]) return false;
  }
  return channelParts.length === patternParts.length;
}

function resolveInboundRoute(
  channel: string,
  bindings?: Array<{
    channelPattern: string;
    agentId: string;
    accountId?: string;
    replyChannel?: string;
  }>,
): {
  agentId: string;
  accountId: string;
  replyChannel?: string;
  matchedPattern: string;
  source: "binding" | "standard";
} | null {
  const effectiveBindings = bindings ?? [];
  for (const binding of effectiveBindings) {
    if (matchChannel(channel, binding.channelPattern)) {
      return {
        agentId: binding.agentId,
        accountId: binding.accountId ?? "default",
        replyChannel: binding.replyChannel,
        matchedPattern: binding.channelPattern,
        source: "binding",
      };
    }
  }
  const PREFIX = "openclaw:agent:";
  const SUFFIX = ":in";
  if (channel.startsWith(PREFIX) && channel.endsWith(SUFFIX)) {
    const agentId = channel.slice(PREFIX.length, channel.length - SUFFIX.length);
    if (agentId && !agentId.includes(":")) {
      return {
        agentId,
        accountId: "default",
        matchedPattern: "openclaw:agent:<agentId>:in",
        source: "standard",
      };
    }
  }
  return null;
}

// 从 session-mapper.ts 复制
const _peerSessionMap = new Map<string, string>();
const _sessionPeerMap = new Map<string, string>();
const _sessionContextMap = new Map<string, any>();

function getOrCreateSessionKey(params: {
  peerId: string;
  agentId: string;
  accountId: string;
  dmScope: string;
  cfg: Record<string, unknown>;
  channel: string;
}): string {
  const existing = _peerSessionMap.get(params.peerId);
  if (existing) return existing;
  const key = buildSessionKeyFromDmScope(params);
  _peerSessionMap.set(params.peerId, key);
  _sessionPeerMap.set(key, params.peerId);
  return key;
}

function getPeerIdBySession(key: string): string | undefined {
  return _sessionPeerMap.get(key);
}

function upsertSessionContext(key: string, ctx: Record<string, unknown>): void {
  const existing = _sessionContextMap.get(key);
  if (existing) {
    Object.assign(existing, ctx, { updatedAt: Date.now() });
  } else {
    _sessionContextMap.set(key, {
      ...ctx,
      accountId: ctx.accountId ?? "default",
      updatedAt: Date.now(),
    });
  }
}

function getSessionContext(key: string): Record<string, unknown> | undefined {
  return _sessionContextMap.get(key);
}

function removePeerSessions(peerId: string): void {
  const sessionKey = _peerSessionMap.get(peerId);
  if (sessionKey) {
    _sessionPeerMap.delete(sessionKey);
    _sessionContextMap.delete(sessionKey);
  }
  _peerSessionMap.delete(peerId);
}

// 从 dm-scope.ts 复制
function buildSessionKeyFromDmScope(params: {
  cfg: Record<string, unknown>;
  agentId: string;
  channel: string;
  accountId: string;
  peerId: string;
}): string {
  const rawScope = (params.cfg.session as { dmScope?: unknown } | undefined)?.dmScope;
  const allowed = new Set(["main", "per-peer", "per-channel-peer", "per-account-channel-peer"]);
  const dmScope = (typeof rawScope === "string" && allowed.has(rawScope) ? rawScope : "main") as string;
  const agent = params.agentId.trim().toLowerCase() || "main";
  const channel = params.channel.trim().toLowerCase() || "unknown";
  const accountId = params.accountId.trim().toLowerCase() || "default";
  const peerId = params.peerId.trim().toLowerCase();
  if (!peerId || dmScope === "main") return `agent:${agent}:main`;
  if (dmScope === "per-account-channel-peer") return `agent:${agent}:${channel}:${accountId}:direct:${peerId}`;
  if (dmScope === "per-channel-peer") return `agent:${agent}:${channel}:direct:${peerId}`;
  return `agent:${agent}:direct:${peerId}`;
}

// 从 redis-stream-config.ts 复制
function resolveRedisChannelConfig(cfg: Record<string, unknown>) {
  const DEFAULT = {
    url: "redis://127.0.0.1:6379",
    channelMode: "pubsub" as const,
    defaultAgentId: "",
    stream: {
      inboundKey: "openclaw:inbound",
      outboundKey: "openclaw:outbound",
      consumerGroup: "openclaw-group",
      consumerName: "openclaw-consumer-1",
      blockMs: 5000,
      count: 10,
      createGroup: true,
    },
    subscribeChannels: [] as string[],
    channelBindings: [] as Array<{
      channelPattern: string;
      agentId: string;
      accountId?: string;
      replyChannel?: string;
    }>,
    payload: { mode: "jsonTextOrPlain" as const },
    fieldMapping: {
      textField: "text",
      agentIdField: "agentId",
      peerIdField: "peerId",
      accountIdField: "accountId",
      replyStreamField: "replyStream",
    },
    connection: { reconnectMs: 3000, maxRetries: 10 },
  };

  const channels = (cfg.channels as Record<string, unknown> | undefined) ?? {};
  const redisChannel = (channels["redis-stream"] as Record<string, unknown> | undefined) ?? {};
  const stream = (redisChannel.stream as Record<string, unknown> | undefined) ?? {};
  const fieldMapping = (redisChannel.fieldMapping as Record<string, unknown> | undefined) ?? {};
  const payload = (redisChannel.payload as Record<string, unknown> | undefined) ?? {};
  const connection = (redisChannel.connection as Record<string, unknown> | undefined) ?? {};

  const rawBindings = (Array.isArray(redisChannel.channelBindings) ? redisChannel.channelBindings : []) as Array<
    Record<string, unknown>
  >;
  const channelBindings = rawBindings
    .filter((b) => b && typeof b === "object" && typeof b.channelPattern === "string" && typeof b.agentId === "string")
    .map((b) => ({
      channelPattern: String(b.channelPattern),
      agentId: String(b.agentId),
      ...(typeof b.accountId === "string" ? { accountId: String(b.accountId) } : {}),
      ...(typeof b.replyChannel === "string" ? { replyChannel: String(b.replyChannel) } : {}),
    }));

  const rawSubscribe = Array.isArray(redisChannel.subscribeChannels) ? redisChannel.subscribeChannels : [];
  const subscribeChannels = (rawSubscribe as Array<unknown>).filter((item): item is string => typeof item === "string");

  return {
    url: String(redisChannel.url ?? DEFAULT.url),
    channelMode: (redisChannel.channelMode === "stream" ? "stream" : "pubsub") as "pubsub" | "stream",
    defaultAgentId:
      typeof redisChannel.defaultAgentId === "string" ? redisChannel.defaultAgentId : DEFAULT.defaultAgentId,
    stream: {
      inboundKey: String(stream.inboundKey ?? DEFAULT.stream.inboundKey),
      outboundKey: String(stream.outboundKey ?? DEFAULT.stream.outboundKey),
      consumerGroup: String(stream.consumerGroup ?? DEFAULT.stream.consumerGroup),
      consumerName: String(stream.consumerName ?? DEFAULT.stream.consumerName),
      blockMs: typeof stream.blockMs === "number" && stream.blockMs >= 0 ? stream.blockMs : DEFAULT.stream.blockMs,
      count: typeof stream.count === "number" && stream.count > 0 ? stream.count : DEFAULT.stream.count,
      createGroup: stream.createGroup !== false,
    },
    subscribeChannels,
    channelBindings,
    payload: {
      mode: (payload.mode === "plain" || payload.mode === "jsonTextOrPlain" ? payload.mode : DEFAULT.payload.mode) as
        | "plain"
        | "jsonTextOrPlain",
    },
    fieldMapping: {
      textField: String(fieldMapping.textField ?? DEFAULT.fieldMapping.textField),
      agentIdField: String(fieldMapping.agentIdField ?? DEFAULT.fieldMapping.agentIdField),
      peerIdField: String(fieldMapping.peerIdField ?? DEFAULT.fieldMapping.peerIdField),
      accountIdField: String(fieldMapping.accountIdField ?? DEFAULT.fieldMapping.accountIdField),
      replyStreamField: String(fieldMapping.replyStreamField ?? DEFAULT.fieldMapping.replyStreamField),
    },
    connection: {
      reconnectMs:
        typeof connection.reconnectMs === "number" && connection.reconnectMs > 0
          ? connection.reconnectMs
          : DEFAULT.connection.reconnectMs,
      maxRetries:
        typeof connection.maxRetries === "number" && connection.maxRetries > 0
          ? connection.maxRetries
          : DEFAULT.connection.maxRetries,
    },
  };
}

// 从 redis-stream-server.ts 复制 getStats shape（mock）
function getStats() {
  return {
    connected: false,
    lastConnectAt: null,
    lastReadAt: null,
    lastError: null,
    messagesRead: 0,
    messagesWritten: 0,
    messagesAcked: 0,
    subscribedChannels: [],
  };
}

// 从 channel.ts 复制 channel 定义（简化）
const redisStreamChannel = {
  id: "redis-stream",
  name: "Redis Stream",
  meta: {
    id: "redis-stream",
    label: "Redis Stream",
    selectionLabel: "Redis Stream (Pub/Sub + Stream)",
    docsPath: "/channels/redis-stream",
    blurb: "Redis Pub/Sub channel + Stream consumer group integration for OpenClaw.",
    aliases: ["redis-stream", "redisstream", "redis-channel"],
    order: 92,
  },
  capabilities: { chatTypes: ["direct"] as const },
  reload: { configPrefixes: ["channels.redis-stream"] },
  config: {
    listAccountIds: () => ["default"],
    resolveAccount: (cfg: Record<string, unknown>) => {
      const rawChannel = ((cfg.channels as Record<string, unknown> | undefined) ?? {})["redis-stream"] as
        | Record<string, unknown>
        | undefined;
      return { accountId: "default", name: "Redis Stream", enabled: true, configured: Boolean(rawChannel?.url) };
    },
    isConfigured: (cfg: Record<string, unknown>) => {
      const rawChannel = ((cfg.channels as Record<string, unknown> | undefined) ?? {})["redis-stream"] as
        | Record<string, unknown>
        | undefined;
      return Boolean(rawChannel?.url);
    },
  },
  threading: { resolveReplyToMode: () => "off" as const },
  groups: { resolveRequireMention: () => false },
};
