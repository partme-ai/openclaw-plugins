/**
 * config/accounts 单元测试
 *
 * 测试覆盖：
 * - 自定义 Agent 映射加载
 * - 账号映射注册和查询
 * - 接待人员缓存
 * - 在线接待人员过滤
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  loadCustomAgentMappings,
  registerAccountMapping,
  getAccountMapping,
  cacheServicers,
  getCachedServicers,
  getOnlineServicers,
  getCustomAgentMappings,
  setCustomAgentMapping,
} from "./accounts.js";
import type { ServicerInfo } from "../types/index.js";

describe("自定义 Agent 映射", () => {
  beforeEach(() => {
    loadCustomAgentMappings({ accounts: {} });
  });

  it("应从配置加载精确映射", () => {
    loadCustomAgentMappings({
      accounts: {
        "acct-001": {
          corpId: "ww123",
          corpSecret: "secret",
          openKfId: "kf_001",
          token: "token",
          encodingAESKey: "key",
          agentMapping: {
            "kf_001": "sales-agent",
            "kf_002": "support-agent",
          },
        },
      },
    });

    const mappings = getCustomAgentMappings();
    expect(mappings["kf_001"]).toBe("sales-agent");
    expect(mappings["kf_002"]).toBe("support-agent");
  });

  it("应从账号级 agentId 加载默认映射", () => {
    loadCustomAgentMappings({
      accounts: {
        "acct-001": {
          corpId: "ww123",
          corpSecret: "secret",
          openKfId: "kf_001",
          token: "token",
          encodingAESKey: "key",
          agentId: "default-agent",
        },
      },
    });

    const mappings = getCustomAgentMappings();
    expect(mappings["kf_001"]).toBe("default-agent");
  });

  it("精确映射应覆盖账号级默认映射", () => {
    loadCustomAgentMappings({
      accounts: {
        "acct-001": {
          corpId: "ww123",
          corpSecret: "secret",
          openKfId: "kf_001",
          token: "token",
          encodingAESKey: "key",
          agentId: "default-agent",
          agentMapping: {
            "kf_001": "specific-agent",
          },
        },
      },
    });

    const mappings = getCustomAgentMappings();
    expect(mappings["kf_001"]).toBe("specific-agent");
  });

  it("setCustomAgentMapping 应手动设置映射", () => {
    setCustomAgentMapping("kf_manual", "manual-agent");
    const mappings = getCustomAgentMappings();
    expect(mappings["kf_manual"]).toBe("manual-agent");
  });
});

describe("账号映射注册和查询", () => {
  it("应注册并查询账号映射", () => {
    registerAccountMapping("kf_100", {
      name: "测试客服",
      avatar: "https://example.com/avatar.png",
      agentId: "agent-100",
    });

    const mapping = getAccountMapping("kf_100");
    expect(mapping).toBeDefined();
    expect(mapping?.name).toBe("测试客服");
    expect(mapping?.agentId).toBe("agent-100");
  });

  it("查询不存在的映射应返回 undefined", () => {
    expect(getAccountMapping("non-existent")).toBeUndefined();
  });
});

describe("接待人员缓存", () => {
  const mockServicers: ServicerInfo[] = [
    { userid: "user1", status: 0 },
    { userid: "user2", status: 1 },
    { userid: "user3", status: 0 },
  ];

  it("应缓存和获取接待人员列表", () => {
    cacheServicers("kf_200", mockServicers);
    const cached = getCachedServicers("kf_200");
    expect(cached).toHaveLength(3);
  });

  it("getOnlineServicers 应仅返回 status=0 的接待人员", () => {
    cacheServicers("kf_200", mockServicers);
    const online = getOnlineServicers("kf_200");
    expect(online).toHaveLength(2);
    expect(online.every((s) => s.status === 0)).toBe(true);
  });

  it("未缓存的账号应返回空数组", () => {
    expect(getOnlineServicers("kf_999")).toHaveLength(0);
  });
});
