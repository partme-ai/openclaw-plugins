/**
 * RabbitMQ Session 映射测试
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  getOrCreateSessionKey,
  getPeerIdBySession,
  upsertSessionContext,
  getSessionContext,
  removePeerSessions,
  getAllSessionMappings,
  getSessionStats,
} from "../src/session-mapper.js";

describe("session-mapper", () => {
  beforeEach(() => {
    const mappings = getAllSessionMappings();
    for (const { peerId } of mappings) {
      removePeerSessions(peerId);
    }
  });

  describe("getOrCreateSessionKey", () => {
    it("should create main scope session key", () => {
      const result = getOrCreateSessionKey({
        cfg: { session: { dmScope: "main" } },
        peerId: "peer1",
        agentId: "agent1",
        accountId: "default",
        channel: "rabbitmq",
      });
      expect(result).toBe("agent:agent1:main");
    });

    it("should create per-peer scope session key", () => {
      const result = getOrCreateSessionKey({
        cfg: { session: { dmScope: "per-peer" } },
        peerId: "peer1",
        agentId: "agent1",
        accountId: "default",
        channel: "rabbitmq",
      });
      expect(result).toBe("agent:agent1:direct:peer1");
    });

    it("should create per-channel-peer scope session key", () => {
      const result = getOrCreateSessionKey({
        cfg: { session: { dmScope: "per-channel-peer" } },
        peerId: "peer1",
        agentId: "agent1",
        accountId: "default",
        channel: "rabbitmq",
      });
      expect(result).toBe("agent:agent1:rabbitmq:direct:peer1");
    });

    it("should create per-account-channel-peer scope session key", () => {
      const result = getOrCreateSessionKey({
        cfg: { session: { dmScope: "per-account-channel-peer" } },
        peerId: "peer1",
        agentId: "agent1",
        accountId: "acc1",
        channel: "rabbitmq",
      });
      expect(result).toBe("agent:agent1:rabbitmq:acc1:direct:peer1");
    });

    it("should reuse existing session key", () => {
      const cfg = { session: { dmScope: "per-peer" } };
      const key1 = getOrCreateSessionKey({ cfg, peerId: "peer1", agentId: "agent1", accountId: "default", channel: "rabbitmq" });
      const key2 = getOrCreateSessionKey({ cfg, peerId: "peer1", agentId: "agent1", accountId: "default", channel: "rabbitmq" });
      expect(key1).toBe(key2);
    });

    it("should create different keys for different peers", () => {
      const cfg = { session: { dmScope: "per-peer" } };
      const key1 = getOrCreateSessionKey({ cfg, peerId: "peer1", agentId: "agent1", accountId: "default", channel: "rabbitmq" });
      const key2 = getOrCreateSessionKey({ cfg, peerId: "peer2", agentId: "agent1", accountId: "default", channel: "rabbitmq" });
      expect(key1).not.toBe(key2);
    });

    it("should normalize agent id", () => {
      const cfg = { session: { dmScope: "per-peer" } };
      const result1 = getOrCreateSessionKey({ cfg, peerId: "peer1", agentId: "Agent1", accountId: "default", channel: "rabbitmq" });
      const result2 = getOrCreateSessionKey({ cfg, peerId: "peer1", agentId: "agent1", accountId: "default", channel: "rabbitmq" });
      expect(result1).toBe(result2);
    });

    it("should default to per-peer when no dmScope configured", () => {
      const result = getOrCreateSessionKey({
        cfg: {},
        peerId: "peer1",
        agentId: "agent1",
        accountId: "default",
        channel: "rabbitmq",
      });
      expect(result).toBe("agent:agent1:direct:peer1");
    });
  });

  describe("getPeerIdBySession", () => {
    it("should return peer id for session key", () => {
      const cfg = { session: { dmScope: "per-peer" } };
      const sessionKey = getOrCreateSessionKey({ cfg, peerId: "peer1", agentId: "agent1", accountId: "default", channel: "rabbitmq" });
      const peerId = getPeerIdBySession(sessionKey);
      expect(peerId).toBe("peer1");
    });

    it("should return null for unknown session key", () => {
      const peerId = getPeerIdBySession("unknown:session:key");
      expect(peerId).toBeNull();
    });
  });

  describe("upsertSessionContext & getSessionContext", () => {
    it("should store and retrieve session context", () => {
      const cfg = { session: { dmScope: "per-peer" } };
      const sessionKey = getOrCreateSessionKey({ cfg, peerId: "peer1", agentId: "agent1", accountId: "default", channel: "rabbitmq" });
      const context = {
        peerId: "peer1",
        agentId: "agent1",
        accountId: "default",
        lastInboundTopic: "topic.in",
        replyTopic: "topic.out",
        updatedAt: Date.now(),
      };
      upsertSessionContext(sessionKey, context);
      const retrieved = getSessionContext(sessionKey);
      expect(retrieved).not.toBeNull();
      if (retrieved) {
        expect(retrieved.peerId).toBe("peer1");
        expect(retrieved.agentId).toBe("agent1");
        expect(retrieved.lastInboundTopic).toBe("topic.in");
      }
    });

    it("should return null for unknown session", () => {
      const context = getSessionContext("unknown:session");
      expect(context).toBeNull();
    });

    it("should update existing context", () => {
      const cfg = { session: { dmScope: "per-peer" } };
      const sessionKey = getOrCreateSessionKey({ cfg, peerId: "peer1", agentId: "agent1", accountId: "default", channel: "rabbitmq" });
      upsertSessionContext(sessionKey, {
        peerId: "peer1",
        agentId: "agent1",
        accountId: "default",
        updatedAt: Date.now(),
      });
      upsertSessionContext(sessionKey, {
        peerId: "peer1",
        agentId: "agent1",
        accountId: "default",
        lastInboundTopic: "new.topic",
        updatedAt: Date.now(),
      });
      const retrieved = getSessionContext(sessionKey);
      expect(retrieved?.lastInboundTopic).toBe("new.topic");
    });
  });

  describe("removePeerSessions", () => {
    it("should remove all sessions for peer", () => {
      const cfg = { session: { dmScope: "per-peer" } };
      getOrCreateSessionKey({ cfg, peerId: "peer1", agentId: "agent1", accountId: "default", channel: "rabbitmq" });
      getOrCreateSessionKey({ cfg, peerId: "peer2", agentId: "agent1", accountId: "default", channel: "rabbitmq" });
      removePeerSessions("peer1");
      const peerId = getPeerIdBySession("agent:agent1:direct:peer1");
      expect(peerId).toBeNull();
      const peerId2 = getPeerIdBySession("agent:agent1:direct:peer2");
      expect(peerId2).toBe("peer2");
    });
  });

  describe("getAllSessionMappings", () => {
    it("should return empty for no sessions", () => {
      const mappings = getAllSessionMappings();
      expect(mappings).toHaveLength(0);
    });

    it("should return all session mappings", () => {
      const cfg = { session: { dmScope: "per-peer" } };
      getOrCreateSessionKey({ cfg, peerId: "peer1", agentId: "agent1", accountId: "default", channel: "rabbitmq" });
      getOrCreateSessionKey({ cfg, peerId: "peer2", agentId: "agent2", accountId: "default", channel: "rabbitmq" });
      const mappings = getAllSessionMappings();
      expect(mappings).toHaveLength(2);
    });
  });

  describe("getSessionStats", () => {
    it("should return zero for no sessions", () => {
      const stats = getSessionStats();
      expect(stats.activeSessions).toBe(0);
      expect(stats.uniquePeers).toBe(0);
      expect(stats.contextBoundSessions).toBe(0);
    });

    it("should count active sessions and unique peers", () => {
      const cfg = { session: { dmScope: "per-peer" } };
      getOrCreateSessionKey({ cfg, peerId: "peer1", agentId: "agent1", accountId: "default", channel: "rabbitmq" });
      getOrCreateSessionKey({ cfg, peerId: "peer2", agentId: "agent1", accountId: "default", channel: "rabbitmq" });
      getOrCreateSessionKey({ cfg, peerId: "peer1", agentId: "agent2", accountId: "default", channel: "rabbitmq" });
      const stats = getSessionStats();
      expect(stats.activeSessions).toBe(3);
      expect(stats.uniquePeers).toBe(2);
    });

    it("should count context bound sessions", () => {
      const cfg = { session: { dmScope: "per-peer" } };
      const sessionKey = getOrCreateSessionKey({ cfg, peerId: "peer1", agentId: "agent1", accountId: "default", channel: "rabbitmq" });
      upsertSessionContext(sessionKey, {
        peerId: "peer1",
        agentId: "agent1",
        accountId: "default",
        updatedAt: Date.now(),
      });
      const stats = getSessionStats();
      expect(stats.contextBoundSessions).toBe(1);
    });
  });
});
