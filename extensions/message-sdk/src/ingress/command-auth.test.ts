/**
 * command-auth 单元测试
 */
import { describe, expect, it } from "vitest";
import {
  createAllowFromNormalizer,
  isSenderInAllowFrom,
  resolveCommandAuthorization,
} from "./command-auth.js";

const normalizeWecom = createAllowFromNormalizer({
  channelId: "wecom",
  stripPrefixes: ["user:", "userid:"],
});

describe("createAllowFromNormalizer", () => {
  it("strips channel and user prefixes", () => {
    expect(normalizeWecom("  WeCom:User:userid:ABC  ")).toBe("abc");
  });

  it("lowercases values", () => {
    expect(normalizeWecom("User1")).toBe("user1");
  });
});

describe("isSenderInAllowFrom", () => {
  it("allows wildcard", () => {
    expect(isSenderInAllowFrom("anyone", ["*"], normalizeWecom)).toBe(true);
  });

  it("matches normalized entries", () => {
    expect(isSenderInAllowFrom("user1", ["wecom:user1"], normalizeWecom)).toBe(true);
    expect(isSenderInAllowFrom("user1", ["user:user1"], normalizeWecom)).toBe(true);
  });

  it("rejects unknown sender", () => {
    expect(isSenderInAllowFrom("user3", ["user1", "user2"], normalizeWecom)).toBe(false);
  });

  it("rejects empty allow list", () => {
    expect(isSenderInAllowFrom("user1", [], normalizeWecom)).toBe(false);
  });
});

describe("resolveCommandAuthorization", () => {
  const core = {
    channel: {
      commands: {
        shouldComputeCommandAuthorized: (rawBody: string) => rawBody.startsWith("/"),
        resolveCommandAuthorizedFromAuthorizers: ({
          authorizers,
        }: {
          authorizers: Array<{ configured: boolean; allowed: boolean }>;
        }) => authorizers.every((a) => !a.configured || a.allowed),
      },
    },
  };

  it("open policy allows commands without allowFrom", async () => {
    const result = await resolveCommandAuthorization({
      core: core as never,
      cfg: { commands: { useAccessGroups: false } } as never,
      accountConfig: { dmPolicy: "open" },
      rawBody: "/help",
      senderUserId: "guest",
      normalizeAllowFrom: normalizeWecom,
    });

    expect(result.shouldComputeAuth).toBe(true);
    expect(result.senderAllowed).toBe(true);
    expect(result.commandAuthorized).toBe(true);
    expect(result.effectiveAllowFrom).toEqual(["*"]);
  });

  it("allowlist policy requires sender in list", async () => {
    const allowed = await resolveCommandAuthorization({
      core: core as never,
      cfg: {} as never,
      accountConfig: { dmPolicy: "allowlist", allowFrom: ["user1"] },
      rawBody: "/status",
      senderUserId: "user1",
      normalizeAllowFrom: normalizeWecom,
    });
    expect(allowed.commandAuthorized).toBe(true);

    const denied = await resolveCommandAuthorization({
      core: core as never,
      cfg: {} as never,
      accountConfig: { dmPolicy: "allowlist", allowFrom: ["user1"] },
      rawBody: "/status",
      senderUserId: "user2",
      normalizeAllowFrom: normalizeWecom,
    });
    expect(denied.commandAuthorized).toBe(false);
  });

  it("skips auth for non-command messages", async () => {
    const result = await resolveCommandAuthorization({
      core: core as never,
      cfg: {} as never,
      accountConfig: { dmPolicy: "allowlist", allowFrom: [] },
      rawBody: "hello",
      senderUserId: "user1",
      normalizeAllowFrom: normalizeWecom,
    });

    expect(result.shouldComputeAuth).toBe(false);
    expect(result.commandAuthorized).toBeUndefined();
  });
});
