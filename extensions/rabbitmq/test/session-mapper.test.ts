/**
 * RabbitMQ Session 映射测试
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  getPeerIdBySession,
  upsertSessionContext,
  getSessionContext,
  removePeerSessions,
  getAllSessionMappings,
  getSessionStats,
} from "../src/routing/session-mapper.js";

const SESSION_PEER1 = "agent:agent1:direct:peer1";
const SESSION_PEER2 = "agent:agent1:direct:peer2";
const SESSION_PEER1_AGENT2 = "agent:agent2:direct:peer1";

describe("session-mapper", () => {
  beforeEach(() => {
    for (const { peerId } of getAllSessionMappings()) {
      removePeerSessions(peerId);
    }
  });

  describe("getPeerIdBySession", () => {
    it("should return peer id for session key after upsert", () => {
      upsertSessionContext(SESSION_PEER1, {
        peerId: "peer1",
        agentId: "agent1",
        accountId: "default",
        updatedAt: Date.now(),
      });
      expect(getPeerIdBySession(SESSION_PEER1)).toBe("peer1");
    });

    it("should return null for unknown session key", () => {
      expect(getPeerIdBySession("unknown:session:key")).toBeNull();
    });
  });

  describe("upsertSessionContext & getSessionContext", () => {
    it("should store and retrieve session context", () => {
      upsertSessionContext(SESSION_PEER1, {
        peerId: "peer1",
        agentId: "agent1",
        accountId: "default",
        lastInboundTopic: "topic.in",
        replyTopic: "topic.out",
        updatedAt: Date.now(),
      });
      const retrieved = getSessionContext(SESSION_PEER1);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.peerId).toBe("peer1");
      expect(retrieved?.lastInboundTopic).toBe("topic.in");
    });

    it("should return null for unknown session", () => {
      expect(getSessionContext("unknown:session")).toBeNull();
    });

    it("should update existing context", () => {
      upsertSessionContext(SESSION_PEER1, {
        peerId: "peer1",
        agentId: "agent1",
        accountId: "default",
        updatedAt: Date.now(),
      });
      upsertSessionContext(SESSION_PEER1, {
        peerId: "peer1",
        agentId: "agent1",
        accountId: "default",
        lastInboundTopic: "new.topic",
        updatedAt: Date.now(),
      });
      expect(getSessionContext(SESSION_PEER1)?.lastInboundTopic).toBe("new.topic");
    });
  });

  describe("removePeerSessions", () => {
    it("should remove all sessions for peer", () => {
      upsertSessionContext(SESSION_PEER1, {
        peerId: "peer1",
        agentId: "agent1",
        accountId: "default",
        updatedAt: Date.now(),
      });
      upsertSessionContext(SESSION_PEER2, {
        peerId: "peer2",
        agentId: "agent1",
        accountId: "default",
        updatedAt: Date.now(),
      });
      removePeerSessions("peer1");
      expect(getPeerIdBySession(SESSION_PEER1)).toBeNull();
      expect(getPeerIdBySession(SESSION_PEER2)).toBe("peer2");
    });
  });

  describe("getAllSessionMappings", () => {
    it("should return empty for no sessions", () => {
      expect(getAllSessionMappings()).toHaveLength(0);
    });

    it("should return all session mappings", () => {
      upsertSessionContext(SESSION_PEER1, {
        peerId: "peer1",
        agentId: "agent1",
        accountId: "default",
        updatedAt: Date.now(),
      });
      upsertSessionContext(SESSION_PEER2, {
        peerId: "peer2",
        agentId: "agent2",
        accountId: "default",
        updatedAt: Date.now(),
      });
      expect(getAllSessionMappings()).toHaveLength(2);
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
      upsertSessionContext(SESSION_PEER1, {
        peerId: "peer1",
        agentId: "agent1",
        accountId: "default",
        updatedAt: Date.now(),
      });
      upsertSessionContext(SESSION_PEER2, {
        peerId: "peer2",
        agentId: "agent1",
        accountId: "default",
        updatedAt: Date.now(),
      });
      upsertSessionContext(SESSION_PEER1_AGENT2, {
        peerId: "peer1",
        agentId: "agent2",
        accountId: "default",
        updatedAt: Date.now(),
      });
      const stats = getSessionStats();
      expect(stats.activeSessions).toBe(3);
      expect(stats.uniquePeers).toBe(2);
    });

    it("should count context bound sessions", () => {
      upsertSessionContext(SESSION_PEER1, {
        peerId: "peer1",
        agentId: "agent1",
        accountId: "default",
        updatedAt: Date.now(),
      });
      expect(getSessionStats().contextBoundSessions).toBe(1);
    });
  });
});
