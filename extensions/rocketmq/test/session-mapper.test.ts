/**
 * RocketMQ Session 上下文存储测试。
 * session key 由 OpenClaw 核心 resolveAgentRoute 生成，本模块仅存储路由上下文。
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
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

  describe("upsertSessionContext & getPeerIdBySession", () => {
    it("should store session context and make peerId retrievable", () => {
      upsertSessionContext("agent:main:direct:peer1", {
        peerId: "peer1",
        agentId: "main",
        accountId: "default",
        replyTopic: "topic.out",
        updatedAt: Date.now(),
      });
      expect(getPeerIdBySession("agent:main:direct:peer1")).toBe("peer1");
    });

    it("should return null for unknown session", () => {
      expect(getPeerIdBySession("unknown:session")).toBeNull();
    });
  });

  describe("upsertSessionContext & getSessionContext", () => {
    it("should store and retrieve session context", () => {
      upsertSessionContext("agent:main:direct:peer1", {
        peerId: "peer1",
        agentId: "main",
        accountId: "default",
        lastInboundTopic: "topic.in",
        replyTopic: "topic.out",
        updatedAt: Date.now(),
      });
      const retrieved = getSessionContext("agent:main:direct:peer1");
      expect(retrieved).not.toBeNull();
      expect(retrieved?.peerId).toBe("peer1");
      expect(retrieved?.lastInboundTopic).toBe("topic.in");
    });

    it("should return null for unknown session", () => {
      expect(getSessionContext("unknown:session")).toBeNull();
    });

    it("should update existing context", () => {
      upsertSessionContext("agent:main:direct:peer1", {
        peerId: "peer1",
        agentId: "main",
        accountId: "default",
        updatedAt: Date.now(),
      });
      upsertSessionContext("agent:main:direct:peer1", {
        peerId: "peer1",
        agentId: "main",
        accountId: "default",
        lastInboundTopic: "new.topic",
        updatedAt: Date.now(),
      });
      expect(getSessionContext("agent:main:direct:peer1")?.lastInboundTopic).toBe("new.topic");
    });
  });

  describe("removePeerSessions", () => {
    it("should remove all sessions for a peer", () => {
      upsertSessionContext("agent:main:direct:peer1", {
        peerId: "peer1",
        agentId: "main",
        accountId: "default",
        updatedAt: Date.now(),
      });
      upsertSessionContext("agent:main:direct:peer2", {
        peerId: "peer2",
        agentId: "main",
        accountId: "default",
        updatedAt: Date.now(),
      });
      removePeerSessions("peer1");
      expect(getPeerIdBySession("agent:main:direct:peer1")).toBeNull();
      expect(getPeerIdBySession("agent:main:direct:peer2")).toBe("peer2");
    });
  });

  describe("getAllSessionMappings", () => {
    it("should return empty for no sessions", () => {
      expect(getAllSessionMappings()).toHaveLength(0);
    });

    it("should return all session mappings", () => {
      upsertSessionContext("s1", {
        peerId: "peer1",
        agentId: "a1",
        accountId: "default",
        updatedAt: Date.now(),
      });
      upsertSessionContext("s2", {
        peerId: "peer2",
        agentId: "a2",
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
      upsertSessionContext("s1", {
        peerId: "peer1",
        agentId: "a1",
        accountId: "default",
        updatedAt: Date.now(),
      });
      upsertSessionContext("s2", {
        peerId: "peer2",
        agentId: "a1",
        accountId: "default",
        updatedAt: Date.now(),
      });
      const stats = getSessionStats();
      expect(stats.activeSessions).toBe(2);
      expect(stats.uniquePeers).toBe(2);
    });

    it("should count context bound sessions", () => {
      upsertSessionContext("s1", {
        peerId: "peer1",
        agentId: "a1",
        accountId: "default",
        updatedAt: Date.now(),
      });
      expect(getSessionStats().contextBoundSessions).toBe(1);
    });
  });
});
