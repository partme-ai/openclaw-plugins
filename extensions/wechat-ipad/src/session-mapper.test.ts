/**
 * session-mapper 单元测试
 * 验证 wxid ↔ sessionKey ↔ agentId 映射逻辑
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  buildSessionKey,
  parseWxidFromSessionKey,
  getOrCreateSession,
  getSessionByWxid,
  getWxidBySessionKey,
  removeSession,
  clearAllSessions,
  getSessionStats,
  listSessions,
} from "./session-mapper.js";

describe("session-mapper", () => {
  beforeEach(() => {
    clearAllSessions();
  });

  describe("buildSessionKey", () => {
    it("应按格式生成 sessionKey", () => {
      const key = buildSessionKey("wxid_abc123", "agent-001");
      expect(key).toBe("wechat-ipad:wxid_abc123@agent-001");
    });
  });

  describe("parseWxidFromSessionKey", () => {
    it("应正确解析 wxid", () => {
      const wxid = parseWxidFromSessionKey("wechat-ipad:wxid_abc123@agent-001");
      expect(wxid).toBe("wxid_abc123");
    });

    it("格式不匹配时返回 null", () => {
      expect(parseWxidFromSessionKey("invalid-key")).toBeNull();
      expect(parseWxidFromSessionKey("stomp:conn@agent")).toBeNull();
    });
  });

  describe("getOrCreateSession", () => {
    it("首次调用应创建新会话", () => {
      const key = getOrCreateSession("wxid_test", "agent-1", false);
      expect(key).toBe("wechat-ipad:wxid_test@agent-1");
    });

    it("重复调用应返回相同 sessionKey", () => {
      const key1 = getOrCreateSession("wxid_test", "agent-1", false);
      const key2 = getOrCreateSession("wxid_test", "agent-1", false);
      expect(key1).toBe(key2);
    });

    it("不同 wxid 应创建不同会话", () => {
      const key1 = getOrCreateSession("wxid_a", "agent-1", false);
      const key2 = getOrCreateSession("wxid_b", "agent-1", false);
      expect(key1).not.toBe(key2);
    });
  });

  describe("getSessionByWxid / getWxidBySessionKey", () => {
    it("应支持双向查找", () => {
      const key = getOrCreateSession("wxid_bidir", "agent-1", false);
      expect(getSessionByWxid("wxid_bidir")).toBe(key);
      expect(getWxidBySessionKey(key)).toBe("wxid_bidir");
    });

    it("不存在的 wxid 返回 null", () => {
      expect(getSessionByWxid("wxid_nonexist")).toBeNull();
    });

    it("不存在的 sessionKey 返回 null", () => {
      expect(getWxidBySessionKey("wechat-ipad:nobody@agent")).toBeNull();
    });
  });

  describe("removeSession", () => {
    it("应同时移除双向映射", () => {
      const key = getOrCreateSession("wxid_rm", "agent-1", false);
      removeSession("wxid_rm");
      expect(getSessionByWxid("wxid_rm")).toBeNull();
      expect(getWxidBySessionKey(key)).toBeNull();
    });
  });

  describe("clearAllSessions", () => {
    it("应清除所有映射", () => {
      getOrCreateSession("wxid_1", "agent-1", false);
      getOrCreateSession("wxid_2", "agent-1", true);
      clearAllSessions();
      expect(getSessionStats().total).toBe(0);
    });
  });

  describe("getSessionStats", () => {
    it("应正确统计私聊和群聊数量", () => {
      getOrCreateSession("wxid_dm1", "agent-1", false);
      getOrCreateSession("wxid_dm2", "agent-1", false);
      getOrCreateSession("wxid_group1", "agent-1", true);

      const stats = getSessionStats();
      expect(stats.total).toBe(3);
      expect(stats.direct).toBe(2);
      expect(stats.group).toBe(1);
    });
  });

  describe("listSessions", () => {
    it("应列出所有会话信息", () => {
      getOrCreateSession("wxid_list1", "agent-a", false);
      getOrCreateSession("wxid_list2", "agent-b", true);

      const list = listSessions();
      expect(list).toHaveLength(2);
      expect(list.map((s) => s.wxid).sort()).toEqual(["wxid_list1", "wxid_list2"]);
    });
  });
});
