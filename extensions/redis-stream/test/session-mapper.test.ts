/**
 * session-mapper 测试。
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  getPeerIdBySession,
  upsertSessionContext,
  getSessionContext,
  removePeerSessions,
  getSessionStats,
} from "../src/routing/session-mapper.js";

describe("session-mapper", () => {
  const SESSION_KEY = "agent:iot-agent:direct:sensor-001";

  beforeEach(() => {
    removePeerSessions("sensor-001");
    removePeerSessions("sensor-002");
  });

  describe("getPeerIdBySession", () => {
    it("returns peerId from session key after upsert", () => {
      upsertSessionContext(SESSION_KEY, {
        peerId: "sensor-001",
        agentId: "iot-agent",
        accountId: "default",
      });
      expect(getPeerIdBySession(SESSION_KEY)).toBe("sensor-001");
    });

    it("returns undefined for unknown session key", () => {
      expect(getPeerIdBySession("agent:unknown:main")).toBeUndefined();
    });
  });

  describe("upsertSessionContext", () => {
    it("creates new context", () => {
      upsertSessionContext(SESSION_KEY, {
        peerId: "sensor-001",
        agentId: "iot-agent",
        accountId: "default",
        lastInboundChannel: "sensor:temperature",
        replyChannel: "sensor:temperature:response",
      });

      const ctx = getSessionContext(SESSION_KEY);
      expect(ctx).toBeDefined();
      expect(ctx!.peerId).toBe("sensor-001");
      expect(ctx!.lastInboundChannel).toBe("sensor:temperature");
      expect(ctx!.replyChannel).toBe("sensor:temperature:response");
      expect(ctx!.updatedAt).toBeGreaterThan(0);
    });

    it("updates existing context", () => {
      upsertSessionContext(SESSION_KEY, { peerId: "sensor-001", agentId: "iot-agent" });
      const ts1 = getSessionContext(SESSION_KEY)!.updatedAt;

      upsertSessionContext(SESSION_KEY, { lastInboundChannel: "sensor:humidity" });
      const ctx2 = getSessionContext(SESSION_KEY)!;
      expect(ctx2.lastInboundChannel).toBe("sensor:humidity");
      expect(ctx2.peerId).toBe("sensor-001");
      expect(ctx2.updatedAt).toBeGreaterThanOrEqual(ts1);
    });
  });

  describe("removePeerSessions", () => {
    it("removes session mapping and context", () => {
      upsertSessionContext(SESSION_KEY, { peerId: "sensor-001", agentId: "iot-agent" });
      removePeerSessions("sensor-001");
      expect(getSessionContext(SESSION_KEY)).toBeUndefined();
      expect(getPeerIdBySession(SESSION_KEY)).toBeUndefined();
    });
  });

  describe("getSessionStats", () => {
    it("returns zero stats when empty", () => {
      const stats = getSessionStats();
      expect(stats.sessionCount).toBe(0);
      expect(stats.peerCount).toBe(0);
    });

    it("reflects sessions after upsert", () => {
      upsertSessionContext(SESSION_KEY, { peerId: "sensor-001", agentId: "iot-agent" });
      const stats = getSessionStats();
      expect(stats.peerCount).toBe(1);
      expect(stats.sessionCount).toBe(1);
    });
  });
});
