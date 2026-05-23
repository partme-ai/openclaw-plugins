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
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import {
  loadCustomAgentMappings,
  loadKfAgentMappingsFromConfig,
  registerAccountMapping,
  getAccountMapping,
  cacheServicers,
  getCachedServicers,
  getOnlineServicers,
  getCustomAgentMappings,
  setCustomAgentMapping,
  resolveKfAccountByOpenKfId,
  listKfAccountIds,
  resolveDefaultKfAccountId,
  applyKfEnvVarFallback,
  DEFAULT_ACCOUNT_ID,
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

describe("KF 多账号 → agentId 解析", () => {
  const baseCfg = {
    channels: {
      "wecom-kf": {
        enabled: true,
        corpId: "ww_corp",
        corpSecret: "secret_shared",
        token: "token_shared",
        encodingAESKey: "aes_shared",
        defaultAccount: "presale-desk",
        accounts: {
          "presale-desk": {
            openKfId: "wk_presale_001",
            agentId: "presale-warm",
          },
          "support-desk": {
            openKfId: "wk_support_001",
            agentId: "aftersale-efficient",
            agentMapping: {
              servicer_alice: "aftersale-patient",
            },
          },
        },
      },
    },
  } as OpenClawConfig;

  it("listKfAccountIds 应返回全部 accountKey", () => {
    expect(listKfAccountIds(baseCfg)).toEqual(["presale-desk", "support-desk"]);
  });

  it("resolveDefaultKfAccountId 应尊重 defaultAccount", () => {
    expect(resolveDefaultKfAccountId(baseCfg)).toBe("presale-desk");
  });

  it("resolveKfAccountByOpenKfId 应按 open_kfid 命中 accountKey 与 agentId", () => {
    const presale = resolveKfAccountByOpenKfId({ cfg: baseCfg, openKfId: "wk_presale_001" });
    expect(presale).toMatchObject({
      accountKey: "presale-desk",
      agentId: "presale-warm",
      openKfId: "wk_presale_001",
    });
    expect(presale?.config.corpId).toBe("ww_corp");

    const support = resolveKfAccountByOpenKfId({ cfg: baseCfg, openKfId: "wk_support_001" });
    expect(support).toMatchObject({
      accountKey: "support-desk",
      agentId: "aftersale-efficient",
      openKfId: "wk_support_001",
    });
  });

  it("未知 open_kfid 应返回 undefined", () => {
    expect(resolveKfAccountByOpenKfId({ cfg: baseCfg, openKfId: "wk_unknown" })).toBeUndefined();
  });

  it("省略 openKfId 应回退 defaultAccount", () => {
    const fallback = resolveKfAccountByOpenKfId({ cfg: baseCfg, openKfId: null });
    expect(fallback?.accountKey).toBe("presale-desk");
    expect(fallback?.agentId).toBe("presale-warm");
  });

  it("loadKfAgentMappingsFromConfig 应注册 open_kfid → agentId", () => {
    loadKfAgentMappingsFromConfig(baseCfg);
    const mappings = getCustomAgentMappings();
    expect(mappings["wk_presale_001"]).toBe("presale-warm");
    expect(mappings["wk_support_001"]).toBe("aftersale-efficient");
    expect(mappings["servicer_alice"]).toBe("aftersale-patient");
  });

  it("applyKfEnvVarFallback 仅对 default 账号注入环境变量", () => {
    const prev = process.env.WECOM_KF_AGENT_ID;
    process.env.WECOM_KF_AGENT_ID = "env-agent";
    try {
      const merged = applyKfEnvVarFallback({ openKfId: "wk_env" }, DEFAULT_ACCOUNT_ID);
      expect(merged.agentId).toBe("env-agent");

      const untouched = applyKfEnvVarFallback({}, "presale-desk");
      expect(untouched.agentId).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.WECOM_KF_AGENT_ID;
      else process.env.WECOM_KF_AGENT_ID = prev;
    }
  });
});
