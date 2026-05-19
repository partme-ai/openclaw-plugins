/**
 * ACL 模块单元测试
 */

import { describe, it, expect } from "vitest";
import { aclTopicMatches, isUserActionAllowed } from "../src/acl.js";

describe("aclTopicMatches", () => {
  it("should match exact topic", () => {
    expect(aclTopicMatches("a/b/c", "a/b/c")).toBe(true);
  });

  it("should support + single-level wildcard", () => {
    expect(aclTopicMatches("a/b/c", "a/+/c")).toBe(true);
    expect(aclTopicMatches("a/b/c", "a/+/d")).toBe(false);
  });

  it("should support # multi-level wildcard", () => {
    expect(aclTopicMatches("a/b/c", "a/#")).toBe(true);
    expect(aclTopicMatches("a/b/c/d", "a/#")).toBe(true);
  });

  it("should handle no match", () => {
    expect(aclTopicMatches("a/b/c", "x/y/z")).toBe(false);
  });
});

describe("isUserActionAllowed", () => {
  const user = {
    username: "test",
    aclRules: [
      { action: "publish" as const, topicPattern: "devices/+/in", effect: "allow" as const },
      { action: "subscribe" as const, topicPattern: "devices/+/out", effect: "allow" as const },
      { action: "publish" as const, topicPattern: "devices/+/admin/#", effect: "deny" as const },
    ],
  };

  it("should allow when rule matches with allow effect", () => {
    expect(
      isUserActionAllowed({ user, action: "publish", topic: "devices/sensor1/in" }),
    ).toBe(true);
  });

  it("should deny when rule matches with deny effect", () => {
    expect(
      isUserActionAllowed({ user, action: "publish", topic: "devices/sensor1/admin/settings" }),
    ).toBe(false);
  });

  it("should deny when no rules match", () => {
    expect(
      isUserActionAllowed({ user, action: "publish", topic: "other/topic" }),
    ).toBe(false);
  });

  it("should fall back to legacy publishAllow/subscribeAllow", () => {
    const legacyUser = {
      username: "legacy",
      publishAllow: ["devices/+/in"],
      subscribeAllow: ["devices/+/out"],
    };
    expect(
      isUserActionAllowed({ user: legacyUser, action: "publish", topic: "devices/sensor1/in" }),
    ).toBe(true);
    expect(
      isUserActionAllowed({ user: legacyUser, action: "subscribe", topic: "devices/sensor1/out" }),
    ).toBe(true);
  });

  it("should allow inbound/outbound when no rules defined", () => {
    const noRulesUser = { username: "norules" };
    expect(
      isUserActionAllowed({ user: noRulesUser, action: "inbound", topic: "any/topic" }),
    ).toBe(true);
    expect(
      isUserActionAllowed({ user: noRulesUser, action: "outbound", topic: "any/topic" }),
    ).toBe(true);
  });
});