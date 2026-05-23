/**
 * dm-policy 单元测试
 */
import { describe, expect, it, vi } from "vitest";

import { checkChannelDmPolicy } from "./dm-policy.js";

describe("checkChannelDmPolicy", () => {
  const runtime = { log: vi.fn(), error: vi.fn() };

  it("群聊消息始终允许", async () => {
    const result = await checkChannelDmPolicy({
      channelId: "wecom",
      senderId: "user1",
      isGroup: true,
      accountId: "default",
      dmPolicy: "disabled",
      readPairingAllowFrom: async () => [],
      runtime,
    });
    expect(result).toEqual({ allowed: true });
  });

  it("open 策略允许任意私聊", async () => {
    const result = await checkChannelDmPolicy({
      channelId: "wecom",
      senderId: "user1",
      isGroup: false,
      accountId: "default",
      dmPolicy: "open",
      readPairingAllowFrom: async () => [],
      runtime,
    });
    expect(result).toEqual({ allowed: true });
  });

  it("disabled 策略拒绝私聊", async () => {
    const result = await checkChannelDmPolicy({
      channelId: "wecom",
      senderId: "user1",
      isGroup: false,
      accountId: "default",
      dmPolicy: "disabled",
      readPairingAllowFrom: async () => [],
      runtime,
    });
    expect(result).toEqual({ allowed: false });
  });

  it("allowlist 策略：白名单内允许", async () => {
    const result = await checkChannelDmPolicy({
      channelId: "wecom",
      senderId: "user1",
      isGroup: false,
      accountId: "default",
      dmPolicy: "allowlist",
      configAllowFrom: ["user1"],
      readPairingAllowFrom: async () => [],
      runtime,
    });
    expect(result).toEqual({ allowed: true });
  });

  it("allowlist 策略：不在白名单拒绝", async () => {
    const result = await checkChannelDmPolicy({
      channelId: "wecom",
      senderId: "user1",
      isGroup: false,
      accountId: "default",
      dmPolicy: "allowlist",
      configAllowFrom: ["other"],
      readPairingAllowFrom: async () => [],
      runtime,
    });
    expect(result).toEqual({ allowed: false });
  });

  it("pairing 策略：创建 pairing 并发送回复", async () => {
    const sendPairingReply = vi.fn().mockResolvedValue(undefined);
    const result = await checkChannelDmPolicy({
      channelId: "wecom",
      senderId: "user1",
      isGroup: false,
      accountId: "default",
      dmPolicy: "pairing",
      readPairingAllowFrom: async () => [],
      upsertPairingRequest: async () => ({ code: "ABC123", created: true }),
      sendPairingReply,
      runtime,
    });
    expect(result).toEqual({ allowed: false, pairingSent: true });
    expect(sendPairingReply).toHaveBeenCalledWith({
      senderId: "user1",
      accountId: "default",
      code: "ABC123",
    });
  });

  it("pairing 策略：缺少 upsertPairingRequest 时拒绝", async () => {
    const result = await checkChannelDmPolicy({
      channelId: "wecom",
      senderId: "user1",
      isGroup: false,
      accountId: "default",
      dmPolicy: "pairing",
      readPairingAllowFrom: async () => [],
      runtime,
    });
    expect(result).toEqual({ allowed: false });
  });
});
