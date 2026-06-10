/**
 * Redis Stream config/resolvers 单元测试。
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_REDIS_STREAM_AGENT_REPLY_TIMEOUT_MS,
  REDIS_STREAM_CHANNEL_ID,
  resolveRedisStreamAgentReplyTimeoutMs,
} from "../src/config/resolvers.js";

describe("REDIS_STREAM_CHANNEL_ID", () => {
  it("matches channel key", () => {
    expect(REDIS_STREAM_CHANNEL_ID).toBe("redis-stream");
  });
});

describe("resolveRedisStreamAgentReplyTimeoutMs", () => {
  it("returns default when unset", () => {
    expect(resolveRedisStreamAgentReplyTimeoutMs({})).toBe(DEFAULT_REDIS_STREAM_AGENT_REPLY_TIMEOUT_MS);
  });

  it("reads channels.redis-stream.network override", () => {
    expect(
      resolveRedisStreamAgentReplyTimeoutMs({
        channels: { "redis-stream": { network: { agentReplyTimeoutMs: 15_000 } } },
      }),
    ).toBe(15_000);
  });
});
