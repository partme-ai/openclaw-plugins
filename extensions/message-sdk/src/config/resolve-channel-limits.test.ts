/**
 * resolve-channel-limits 单元测试
 */
import { describe, expect, it } from "vitest";
import {
  resolveChannelAgentReplyTimeoutMs,
  resolveChannelEgressProxyUrl,
  resolveChannelMediaMaxBytes,
} from "./resolve-channel-limits.js";

describe("resolveChannelMediaMaxBytes", () => {
  it("通道专属 maxBytes 优先", () => {
    const bytes = resolveChannelMediaMaxBytes({
      channelId: "wecom",
      cfg: { channels: { wecom: { media: { maxBytes: 50 * 1024 * 1024 } } } },
      channelDefaultBytes: 20 * 1024 * 1024,
    });
    expect(bytes).toBe(50 * 1024 * 1024);
  });

  it("回退 agents.defaults.mediaMaxMb", () => {
    const bytes = resolveChannelMediaMaxBytes({
      channelId: "wecom",
      cfg: { agents: { defaults: { mediaMaxMb: 10 } } },
      channelDefaultBytes: 20 * 1024 * 1024,
    });
    expect(bytes).toBe(10 * 1024 * 1024);
  });
});

describe("resolveChannelAgentReplyTimeoutMs", () => {
  it("通道 network 配置优先", () => {
    const ms = resolveChannelAgentReplyTimeoutMs({
      channelId: "wecom",
      cfg: { channels: { wecom: { network: { agentReplyTimeoutMs: 120_000 } } } },
      defaultTimeoutMs: 360_000,
    });
    expect(ms).toBe(120_000);
  });
});

describe("resolveChannelEgressProxyUrl", () => {
  it("通道 network.egressProxyUrl 优先", () => {
    const url = resolveChannelEgressProxyUrl({
      channelId: "wecom",
      cfg: { channels: { wecom: { network: { egressProxyUrl: "http://proxy.local:8080" } } } },
    });
    expect(url).toBe("http://proxy.local:8080");
  });
});
