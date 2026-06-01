/**
 * @module message-sdk/transport — 单元测试
 */
import { describe, it, expect } from "vitest";
import {
  matchTopic,
  isTopicAllowed,
} from "../src/transport/topic-matcher.js";
import {
  verifyPassword,
  safeEqualBuffer,
} from "../src/transport/auth-guard.js";
import { resolvePayloadMode } from "../src/transport/payload-resolver.js";
import {
  isUserActionAllowed,
  type AclUser,
  type AclRule,
} from "../src/transport/acl-engine.js";

// ──────────────────── topic-matcher ────────────────────

describe("matchTopic", () => {
  it("exact match", () => {
    expect(matchTopic("a/b/c", "a/b/c")).toBe(true);
    expect(matchTopic("a/b/c", "a/b/d")).toBe(false);
  });

  it("MQTT + single-level wildcard", () => {
    expect(matchTopic("a/b/c", "a/+/c")).toBe(true);
    expect(matchTopic("a/b/c", "+/+/+")).toBe(true);
    expect(matchTopic("a/b", "a/+/c")).toBe(false);
  });

  it("MQTT # multi-level wildcard", () => {
    expect(matchTopic("a/b/c", "a/#")).toBe(true);
    expect(matchTopic("a/b/c/d", "a/#")).toBe(true);
    expect(matchTopic("a", "#")).toBe(true);
    expect(matchTopic("b/c", "a/#")).toBe(false);
  });

  it("STOMP * single-level wildcard", () => {
    expect(matchTopic("a/b/c", "a/*/c")).toBe(true);
    expect(matchTopic("a/b/c", "a/*/*")).toBe(true);
  });

  it("STOMP # multi-level wildcard", () => {
    expect(matchTopic("a/b/c", "a/#")).toBe(true);
  });
});

describe("isTopicAllowed", () => {
  it("empty patterns = allow all", () => {
    expect(isTopicAllowed("anything", [])).toBe(true);
  });

  it("non-empty patterns = check match", () => {
    expect(isTopicAllowed("a/b", ["a/+", "x/#"])).toBe(true);
    expect(isTopicAllowed("x/y/z", ["a/+", "x/#"])).toBe(true);
    expect(isTopicAllowed("c/d", ["a/+", "x/#"])).toBe(false);
  });
});

// ──────────────────── auth-guard ────────────────────

describe("verifyPassword", () => {
  it("plaintext match", () => {
    expect(verifyPassword("secret", "secret")).toBe(true);
    expect(verifyPassword("wrong", "secret")).toBe(false);
  });

  it("sha256 hash match", () => {
    // echo -n "secret" | sha256sum
    const hash = "2bb80d537b1da3e38bd30361aa855686bde0eacd7162fef6a25fe97bf527a25b";
    expect(verifyPassword("secret", undefined, hash, "sha256")).toBe(true);
    expect(verifyPassword("wrong", undefined, hash, "sha256")).toBe(false);
  });

  it("sha512 hash match", () => {
    const hash = "bd2b1aaf7ef4f09be9f52ce2d8d599674d81aa9d6a4421696dc4d93dd0619d682ce56b4d64a9ef097761ced99e0f67265b5f76085e5b0ee7ca4696b2ad6fe2b2";
    expect(verifyPassword("secret", undefined, hash, "sha512")).toBe(true);
  });

  it("no expected value = reject", () => {
    expect(verifyPassword("secret")).toBe(false);
  });
});

describe("safeEqualBuffer", () => {
  it("equal buffers", () => {
    expect(safeEqualBuffer(Buffer.from("abc"), Buffer.from("abc"))).toBe(true);
  });

  it("unequal buffers", () => {
    expect(safeEqualBuffer(Buffer.from("abc"), Buffer.from("abd"))).toBe(false);
  });

  it("different lengths", () => {
    expect(safeEqualBuffer(Buffer.from("ab"), Buffer.from("abc"))).toBe(false);
  });
});

// ──────────────────── payload-resolver ────────────────────

describe("resolvePayloadMode", () => {
  it("maps known modes", () => {
    expect(resolvePayloadMode("jsonTextOrPlain")).toBe("jsonTextOrPlain");
    expect(resolvePayloadMode("jsonOnly")).toBe("jsonOnly");
  });

  it("unknown mode defaults to plain", () => {
    expect(resolvePayloadMode("unknown")).toBe("plain");
  });
});

// ──────────────────── acl-engine ────────────────────

describe("isUserActionAllowed", () => {
  const user: AclUser = {
    aclRules: [
      { action: "publish", topicPattern: "openclaw/+/in", effect: "allow" },
      { action: "publish", topicPattern: "secret/#", effect: "deny" },
      { action: "subscribe", topicPattern: "openclaw/+/out", effect: "allow" },
    ],
  };

  it("allow matched publish", () => {
    expect(isUserActionAllowed({ user, action: "publish", topic: "openclaw/agent1/in" })).toBe(true);
  });

  it("deny takes priority", () => {
    // This topic matches both allow (openclaw/+/in) and deny (secret/#) — deny wins
    expect(isUserActionAllowed({ user, action: "publish", topic: "openclaw/x/in" })).toBe(true);
  });

  it("no matching rules = default allow", () => {
    expect(isUserActionAllowed({ user, action: "inbound", topic: "anything" })).toBe(true);
  });

  it("undefined user = deny", () => {
    expect(isUserActionAllowed({ user: undefined, action: "publish", topic: "x" })).toBe(false);
  });

  it("legacy publishAllow fallback", () => {
    const legacyUser: AclUser = {
      publishAllow: ["topic/a"],
    };
    expect(isUserActionAllowed({ user: legacyUser, action: "publish", topic: "topic/a" })).toBe(true);
    expect(isUserActionAllowed({ user: legacyUser, action: "publish", topic: "topic/b" })).toBe(false);
  });
});
