/**
 * Web MQTT ACL 单元测试。
 */
import { describe, expect, it } from "vitest";

import { isUserActionAllowed } from "../src/transport/acl.js";

describe("isUserActionAllowed", () => {
  const userWithRules = {
    username: "alice",
    aclRules: [
      { action: "publish" as const, topicPattern: "devices/+/in", effect: "allow" as const },
      { action: "inbound" as const, topicPattern: "devices/+/in", effect: "allow" as const },
      { action: "outbound" as const, topicPattern: "devices/+/out", effect: "allow" as const },
      { action: "publish" as const, topicPattern: "admin/#", effect: "deny" as const },
    ],
  };

  it("allows inbound when rule matches", () => {
    expect(
      isUserActionAllowed({
        user: userWithRules,
        action: "inbound",
        topic: "devices/sensor/in",
      }),
    ).toBe(true);
  });

  it("denies when deny rule matches first", () => {
    expect(
      isUserActionAllowed({
        user: userWithRules,
        action: "publish",
        topic: "admin/settings",
      }),
    ).toBe(false);
  });

  it("denies subscribe when action rules exist but none match", () => {
    const user = {
      username: "alice",
      aclRules: [
        { action: "subscribe" as const, topicPattern: "allowed/+/out", effect: "allow" as const },
      ],
    };
    expect(
      isUserActionAllowed({
        user,
        action: "subscribe",
        topic: "devices/sensor/out",
      }),
    ).toBe(false);
  });

  it("falls back to legacy publishAllow for inbound", () => {
    const legacy = {
      username: "legacy",
      publishAllow: ["openclaw/agent/+/in"],
    };
    expect(
      isUserActionAllowed({
        user: legacy,
        action: "inbound",
        topic: "openclaw/agent/demo/in",
      }),
    ).toBe(true);
  });

  it("allows inbound/outbound when user has no rules", () => {
    expect(
      isUserActionAllowed({
        user: { username: "open" },
        action: "inbound",
        topic: "any/topic",
      }),
    ).toBe(true);
    expect(
      isUserActionAllowed({
        user: { username: "open" },
        action: "outbound",
        topic: "any/topic",
      }),
    ).toBe(true);
  });

  it("respects accountId scoping on acl rules", () => {
    const user = {
      username: "scoped",
      aclRules: [
        {
          action: "inbound" as const,
          topicPattern: "team/+/in",
          effect: "allow" as const,
          accountId: "team-a",
        },
      ],
    };
    expect(
      isUserActionAllowed({
        user,
        action: "inbound",
        topic: "team/x/in",
        accountId: "team-a",
      }),
    ).toBe(true);
    expect(
      isUserActionAllowed({
        user,
        action: "inbound",
        topic: "team/x/in",
        accountId: "team-b",
      }),
    ).toBe(false);
  });
});
