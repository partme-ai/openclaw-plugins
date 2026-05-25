/**
 * 配置解析测试。
 */
import { describe, it, expect } from "vitest";
import { resolveRedisChannelConfig, DEFAULT_REDIS_CHANNEL_CONFIG } from "../src/config.js";

describe("resolveRedisChannelConfig", () => {
  it("returns defaults when config is empty", () => {
    const config = resolveRedisChannelConfig({});
    expect(config.url).toBe(DEFAULT_REDIS_CHANNEL_CONFIG.url);
    expect(config.channelMode).toBe("pubsub");
    expect(config.stream.inboundKey).toBe("openclaw:inbound");
    expect(config.payload.mode).toBe("jsonTextOrPlain");
  });

  it("reads url from channels.redis-stream", () => {
    const config = resolveRedisChannelConfig({
      channels: {
        "redis-stream": {
          url: "redis://myhost:6380",
        },
      },
    });
    expect(config.url).toBe("redis://myhost:6380");
  });

  it("reads channelMode pubsub", () => {
    const config = resolveRedisChannelConfig({
      channels: {
        "redis-stream": {
          url: "redis://localhost:6379",
          channelMode: "pubsub",
        },
      },
    });
    expect(config.channelMode).toBe("pubsub");
  });

  it("reads channelMode stream", () => {
    const config = resolveRedisChannelConfig({
      channels: {
        "redis-stream": {
          url: "redis://localhost:6379",
          channelMode: "stream",
        },
      },
    });
    expect(config.channelMode).toBe("stream");
  });

  it("reads pendingClaimIdleMs for stream mode", () => {
    const config = resolveRedisChannelConfig({
      channels: {
        "redis-stream": {
          url: "redis://localhost:6379",
          channelMode: "stream",
          stream: { pendingClaimIdleMs: 60_000 },
        },
      },
    });
    expect(config.stream.pendingClaimIdleMs).toBe(60_000);
  });

  it("defaults pendingClaimIdleMs when omitted", () => {
    const config = resolveRedisChannelConfig({
      channels: {
        "redis-stream": {
          url: "redis://localhost:6379",
          channelMode: "stream",
        },
      },
    });
    expect(config.stream.pendingClaimIdleMs).toBe(120_000);
  });

  it("defaults to pubsub for invalid channelMode", () => {
    const config = resolveRedisChannelConfig({
      channels: {
        "redis-stream": {
          url: "redis://localhost:6379",
          channelMode: "invalid",
        },
      },
    });
    expect(config.channelMode).toBe("pubsub");
  });

  it("parses channelBindings", () => {
    const config = resolveRedisChannelConfig({
      channels: {
        "redis-stream": {
          url: "redis://localhost:6379",
          channelBindings: [
            { channelPattern: "test:*", agentId: "agent1" },
            { channelPattern: "sensor:temp", agentId: "agent2", accountId: "acct2", replyChannel: "resp" },
          ],
        },
      },
    });
    expect(config.channelBindings).toHaveLength(2);
    expect(config.channelBindings[0]).toEqual({
      channelPattern: "test:*",
      agentId: "agent1",
    });
    expect(config.channelBindings[1].replyChannel).toBe("resp");
  });

  it("filters invalid bindings", () => {
    const config = resolveRedisChannelConfig({
      channels: {
        "redis-stream": {
          url: "redis://localhost:6379",
          channelBindings: [
            { channelPattern: "valid:*", agentId: "agent1" },
            { channelPattern: "no-agent" }, // missing agentId
            { agentId: "no-pattern" }, // missing channelPattern
          ],
        },
      },
    });
    expect(config.channelBindings).toHaveLength(1);
    expect(config.channelBindings[0].agentId).toBe("agent1");
  });

  it("parses subscribeChannels", () => {
    const config = resolveRedisChannelConfig({
      channels: {
        "redis-stream": {
          url: "redis://localhost:6379",
          subscribeChannels: ["openclaw:*", "sensor:*"],
        },
      },
    });
    expect(config.subscribeChannels).toEqual(["openclaw:*", "sensor:*"]);
  });

  it("parses stream config", () => {
    const config = resolveRedisChannelConfig({
      channels: {
        "redis-stream": {
          url: "redis://localhost:6379",
          stream: {
            inboundKey: "custom:in",
            outboundKey: "custom:out",
            consumerGroup: "my-group",
            consumerName: "my-consumer",
            blockMs: 10000,
            count: 5,
            createGroup: false,
          },
        },
      },
    });
    expect(config.stream.inboundKey).toBe("custom:in");
    expect(config.stream.outboundKey).toBe("custom:out");
    expect(config.stream.consumerGroup).toBe("my-group");
    expect(config.stream.consumerName).toBe("my-consumer");
    expect(config.stream.blockMs).toBe(10000);
    expect(config.stream.count).toBe(5);
    expect(config.stream.createGroup).toBe(false);
  });

  it("prefers process.env.REDIS_URL over config file url", () => {
    process.env.REDIS_URL = "redis://env-provided:6379";
    try {
      const config = resolveRedisChannelConfig({
        channels: {
          "redis-stream": {
            url: "redis://from-config:6380",
          },
        },
      });
      expect(config.url).toBe("redis://env-provided:6379");
    } finally {
      delete process.env.REDIS_URL;
    }
  });

  it("uses REDIS_URL even when config url is missing", () => {
    process.env.REDIS_URL = "redis://env-only:6379";
    try {
      const config = resolveRedisChannelConfig({});
      expect(config.url).toBe("redis://env-only:6379");
    } finally {
      delete process.env.REDIS_URL;
    }
  });

  it("parses payload mode", () => {
    const plain = resolveRedisChannelConfig({
      channels: {
        "redis-stream": {
          url: "redis://localhost:6379",
          payload: { mode: "plain" },
        },
      },
    });
    expect(plain.payload.mode).toBe("plain");

    const json = resolveRedisChannelConfig({
      channels: {
        "redis-stream": {
          url: "redis://localhost:6379",
          payload: { mode: "jsonTextOrPlain" },
        },
      },
    });
    expect(json.payload.mode).toBe("jsonTextOrPlain");
  });
});
