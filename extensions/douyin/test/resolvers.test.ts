/**
 * Douyin message-sdk resolver wiring tests.
 */
import { describe, expect, it } from "vitest";

import {
  resolveDouyinAgentReplyTimeoutMs,
  resolveDouyinEgressProxyUrl,
  resolveDouyinMediaMaxBytes,
} from "../src/config/resolvers.js";

describe("douyin config resolvers", () => {
  it("uses 20MB default media max bytes", () => {
    expect(resolveDouyinMediaMaxBytes({ channels: {} })).toBe(20 * 1024 * 1024);
  });

  it("honours channels.douyin.media.maxBytes override", () => {
    const cfg = { channels: { douyin: { media: { maxBytes: 5 * 1024 * 1024 } } } };
    expect(resolveDouyinMediaMaxBytes(cfg)).toBe(5 * 1024 * 1024);
  });

  it("uses 10 minute default agent reply timeout", () => {
    expect(resolveDouyinAgentReplyTimeoutMs({ channels: {} })).toBe(10 * 60 * 1000);
  });

  it("honours channels.douyin.network.agentReplyTimeoutMs override", () => {
    const cfg = { channels: { douyin: { network: { agentReplyTimeoutMs: 120_000 } } } };
    expect(resolveDouyinAgentReplyTimeoutMs(cfg)).toBe(120_000);
  });

  it("returns undefined egress proxy when not configured", () => {
    expect(resolveDouyinEgressProxyUrl({ channels: {} })).toBeUndefined();
  });

  it("reads channels.douyin.network.egressProxyUrl", () => {
    const cfg = {
      channels: { douyin: { network: { egressProxyUrl: "http://127.0.0.1:7890" } } },
    };
    expect(resolveDouyinEgressProxyUrl(cfg)).toBe("http://127.0.0.1:7890");
  });
});
