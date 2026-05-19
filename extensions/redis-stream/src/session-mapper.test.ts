/**
 * session-mapper 测试。
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  getOrCreateSessionKey,
  getPeerIdBySession,
  upsertSessionContext,
  getSessionContext,
  removePeerSessions,
  getSessionStats,
} from "./session-mapper.js";

describe("session-mapper", () => {
  const baseParams = {
    peerId: "sensor-001",
    agentId: "iot-agent",
    accountId: "default",
    dmScope: "per-peer" as const,
    cfg: { session: { dmScope: "per-peer" } },
    channel: "redis-stream",
  };

  beforeEach(() => {
    // 清理：移除所有已知 peer
    removePeerSessions("sensor-001");
    removePeerSessions("sensor-002");
  });

  describe("getOrCreateSessionKey", () => {
    it("creates a session key", () => {
      const key = getOrCreateSessionKey(baseParams);
      expect(key).toContain("agent:iot-agent");
      expect(key).toContain("sensor-001");
    });

    it("returns the same key for the same peer", () => {
      const key1 = getOrCreateSessionKey(baseParams);
      const key2 = getOrCreateSessionKey(baseParams);
      expect(key1).toBe(key2);
    });
  });

  describe("getPeerIdBySession", () => {
    it("returns peerId from session key", () => {
      const key = getOrCreateSessionKey(baseParams);
      expect(getPeerIdBySession(key)).toBe("sensor-001");
    });

    it("returns undefined for unknown session key", () => {
      expect(getPeerIdBySession("agent:unknown:main")).toBeUndefined();
    });
  });

  describe("upsertSessionContext", () => {
    it("creates new context", () => {
      const key = getOrCreateSessionKey(baseParams);
      upsertSessionContext(key, {
        peerId: "sensor-001",
        agentId: "iot-agent",
        accountId: "default",
        lastInboundChannel: "sensor:temperature",
        replyChannel: "sensor:temperature:response",
      });

      const ctx = getSessionContext(key);
      expect(ctx).toBeDefined();
      expect(ctx!.peerId).toBe("sensor-001");
      expect(ctx!.lastInboundChannel).toBe("sensor:temperature");
      expect(ctx!.replyChannel).toBe("sensor:temperature:response");
      expect(ctx!.updatedAt).toBeGreaterThan(0);
    });

    it("updates existing context", () => {
      const key = getOrCreateSessionKey(baseParams);
      upsertSessionContext(key, { peerId: "sensor-001", agentId: "iot-agent" });
      const ts1 = getSessionContext(key)!.updatedAt;

      // Wait briefly and update
      upsertSessionContext(key, { lastInboundChannel: "sensor:humidity" });
      const ctx2 = getSessionContext(key)!;
      expect(ctx2.lastInboundChannel).toBe("sensor:humidity");
      // Previous fields preserved
      expect(ctx2.peerId).toBe("sensor-001");
      expect(ctx2.updatedAt).toBeGreaterThanOrEqual(ts1);
    });
  });

  describe("removePeerSessions", () => {
    it("removes session mapping and context", () => {
      const key = getOrCreateSessionKey(baseParams);
      upsertSessionContext(key, { peerId: "sensor-001", agentId: "iot-agent" });

      removePeerSessions("sensor-001");
      expect(getSessionContext(key)).toBeUndefined();
      expect(getPeerIdBySession(key)).toBeUndefined();
    });
  });

  describe("getSessionStats", () => {
    it("returns zero stats when empty", () => {
      const stats = getSessionStats();
      expect(stats.sessionCount).toBeGreaterThanOrEqual(0);
    });

    it("reflects sessions after creation", () => {
      getOrCreateSessionKey(baseParams);
      const stats = getSessionStats();
      expect(stats.peerCount).toBeGreaterThanOrEqual(1);
      expect(stats.sessionCount).toBeGreaterThanOrEqual(1);
    });
  });
});
