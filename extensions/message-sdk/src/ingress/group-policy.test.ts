/**
 * group-policy 单元测试
 */
import { describe, expect, it } from "vitest";
import {
  checkChannelGroupPolicy,
  isSenderInAllowlist,
  resolveChannelGroupConfig,
} from "./group-policy.js";

describe("isSenderInAllowlist", () => {
  it("通配符 * 允许所有人", () => {
    expect(isSenderInAllowlist("anyone", ["*"], "wecom")).toBe(true);
  });

  it("精确匹配与 user: 前缀", () => {
    expect(isSenderInAllowlist("user1", ["user1"], "wecom")).toBe(true);
    expect(isSenderInAllowlist("user1", ["user:user1"], "wecom")).toBe(true);
  });

  it("渠道前缀被剥离", () => {
    expect(isSenderInAllowlist("user1", ["wecom:user1"], "wecom")).toBe(true);
  });
});

describe("checkChannelGroupPolicy", () => {
  const runtime = { log: () => {} };

  it("open 策略允许任意群组", () => {
    const result = checkChannelGroupPolicy({
      channelId: "wecom",
      chatId: "any-group",
      senderId: "anyone",
      channelConfig: { groupPolicy: "open" },
      runtime,
    });
    expect(result.allowed).toBe(true);
  });

  it("disabled 策略拒绝所有", () => {
    const result = checkChannelGroupPolicy({
      channelId: "wecom",
      chatId: "g1",
      senderId: "u1",
      channelConfig: { groupPolicy: "disabled" },
      runtime,
    });
    expect(result.allowed).toBe(false);
  });

  it("群内发送者白名单", () => {
    const result = checkChannelGroupPolicy({
      channelId: "wecom",
      chatId: "g1",
      senderId: "normal-user",
      channelConfig: {
        groupPolicy: "open",
        groups: { g1: { allowFrom: ["admin1"] } },
      },
      runtime,
    });
    expect(result.allowed).toBe(false);
  });
});

describe("resolveChannelGroupConfig", () => {
  it("支持通配 *", () => {
    const cfg = resolveChannelGroupConfig({
      groups: { "*": { allowFrom: ["*"] } },
      groupId: "unknown",
    });
    expect(cfg?.allowFrom).toEqual(["*"]);
  });
});
