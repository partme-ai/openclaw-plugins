/**
 * Web STOMP config/resolvers 单元测试。
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_WEB_STOMP_AGENT_REPLY_TIMEOUT_MS,
  DEFAULT_WEB_STOMP_MEDIA_MAX_BYTES,
  WEB_STOMP_CHANNEL_ID,
  resolveWebStompAgentReplyTimeoutMs,
  resolveWebStompMediaMaxBytes,
} from "../src/config/resolvers.js";

describe("WEB_STOMP_CHANNEL_ID", () => {
  it("matches stomp channel key", () => {
    expect(WEB_STOMP_CHANNEL_ID).toBe("stomp");
  });
});

describe("resolveWebStompAgentReplyTimeoutMs", () => {
  it("returns default when unset", () => {
    expect(resolveWebStompAgentReplyTimeoutMs({})).toBe(DEFAULT_WEB_STOMP_AGENT_REPLY_TIMEOUT_MS);
  });

  it("reads channels.stomp.network override", () => {
    expect(
      resolveWebStompAgentReplyTimeoutMs({
        channels: { stomp: { network: { agentReplyTimeoutMs: 90_000 } } },
      }),
    ).toBe(90_000);
  });
});

describe("resolveWebStompMediaMaxBytes", () => {
  it("returns default when unset", () => {
    expect(resolveWebStompMediaMaxBytes({})).toBe(DEFAULT_WEB_STOMP_MEDIA_MAX_BYTES);
  });

  it("reads channels.stomp.media.maxBytes override", () => {
    expect(
      resolveWebStompMediaMaxBytes({
        channels: { stomp: { media: { maxBytes: 4096 } } },
      }),
    ).toBe(4096);
  });
});
