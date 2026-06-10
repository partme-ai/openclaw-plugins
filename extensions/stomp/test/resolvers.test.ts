/**
 * STOMP config/resolvers 单元测试。
 */
import { describe, expect, it } from "vitest";

import { stompTcpChannelFixture } from "../../../test-utils/channel-fixtures.js";
import {
  DEFAULT_STOMP_TCP_AGENT_REPLY_TIMEOUT_MS,
  DEFAULT_STOMP_TCP_MEDIA_MAX_BYTES,
  STOMP_TCP_CHANNEL_ID,
  resolveStompTcpAgentReplyTimeoutMs,
  resolveStompTcpMediaMaxBytes,
} from "../src/config/resolvers.js";

describe("STOMP_TCP_CHANNEL_ID", () => {
  it("matches openclaw channel key", () => {
    expect(STOMP_TCP_CHANNEL_ID).toBe("stomp-tcp");
  });
});

describe("resolveStompTcpAgentReplyTimeoutMs", () => {
  it("returns channel default when unset", () => {
    expect(resolveStompTcpAgentReplyTimeoutMs({})).toBe(DEFAULT_STOMP_TCP_AGENT_REPLY_TIMEOUT_MS);
  });

  it("reads per-channel override from channels.stomp-tcp.network", () => {
    const cfg = {
      channels: {
        "stomp-tcp": {
          network: { agentReplyTimeoutMs: 45_000 },
        },
      },
    };
    expect(resolveStompTcpAgentReplyTimeoutMs(cfg)).toBe(45_000);
  });
});

describe("resolveStompTcpMediaMaxBytes", () => {
  it("returns channel default when unset", () => {
    expect(resolveStompTcpMediaMaxBytes({})).toBe(DEFAULT_STOMP_TCP_MEDIA_MAX_BYTES);
  });

  it("reads channels.stomp-tcp.media.maxBytes override", () => {
    const cfg = {
      channels: {
        "stomp-tcp": { media: { maxBytes: 1024 } },
      },
    };
    expect(resolveStompTcpMediaMaxBytes(cfg)).toBe(1024);
  });
});
