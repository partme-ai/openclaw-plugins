/**
 * dmScope 会话隔离测试
 *
 * 测试覆盖：
 * - 不同 dmScope 下的会话键生成
 * - 会话键格式验证
 * - 配置缺失时的默认行为
 * - 非法 dmScope 值的处理
 */

import { describe, it, expect } from "vitest";
import { resolveDmScopeFromRuntimeConfig, buildSessionKeyFromDmScope } from "./dm-scope.js";

describe("dmScope", () => {
  describe("resolveDmScopeFromRuntimeConfig", () => {
    it("应返回配置中的 dmScope", () => {
      const config = {
        session: {
          dmScope: "per-peer"
        }
      };
      expect(resolveDmScopeFromRuntimeConfig(config)).toBe("per-peer");
    });

    it("配置缺失时应返回 main", () => {
      const config = {};
      expect(resolveDmScopeFromRuntimeConfig(config)).toBe("main");
    });

    it("非法 dmScope 值应返回 main", () => {
      const config = {
        session: {
          dmScope: "invalid-scope"
        }
      };
      expect(resolveDmScopeFromRuntimeConfig(config)).toBe("main");
    });

    it("空 dmScope 应返回 main", () => {
      const config = {
        session: {
          dmScope: ""
        }
      };
      expect(resolveDmScopeFromRuntimeConfig(config)).toBe("main");
    });
  });

  describe("buildSessionKeyFromDmScope", () => {
    const testConfig = {
      session: {
        dmScope: "main"
      }
    };

    const testParams = {
      cfg: testConfig,
      agentId: "test-agent",
      channel: "test-channel",
      accountId: "test-account",
      peerId: "test-peer"
    };

    it("main 作用域应生成 agent:agentId:main 格式", () => {
      const config = {
        session: {
          dmScope: "main"
        }
      };
      const result = buildSessionKeyFromDmScope({
        ...testParams,
        cfg: config
      });
      expect(result).toBe("agent:test-agent:main");
    });

    it("per-peer 作用域应生成 agent:agentId:direct:peerId 格式", () => {
      const config = {
        session: {
          dmScope: "per-peer"
        }
      };
      const result = buildSessionKeyFromDmScope({
        ...testParams,
        cfg: config
      });
      expect(result).toBe("agent:test-agent:direct:test-peer");
    });

    it("per-channel-peer 作用域应生成 agent:agentId:channel:direct:peerId 格式", () => {
      const config = {
        session: {
          dmScope: "per-channel-peer"
        }
      };
      const result = buildSessionKeyFromDmScope({
        ...testParams,
        cfg: config
      });
      expect(result).toBe("agent:test-agent:test-channel:direct:test-peer");
    });

    it("per-account-channel-peer 作用域应生成 agent:agentId:channel:accountId:direct:peerId 格式", () => {
      const config = {
        session: {
          dmScope: "per-account-channel-peer"
        }
      };
      const result = buildSessionKeyFromDmScope({
        ...testParams,
        cfg: config
      });
      expect(result).toBe("agent:test-agent:test-channel:test-account:direct:test-peer");
    });

    it("peerId 为空时应使用 main 格式", () => {
      const config = {
        session: {
          dmScope: "per-peer"
        }
      };
      const result = buildSessionKeyFromDmScope({
        ...testParams,
        cfg: config,
        peerId: ""
      });
      expect(result).toBe("agent:test-agent:main");
    });

    it("应标准化 token 格式（小写、去空格）", () => {
      const config = {
        session: {
          dmScope: "per-peer"
        }
      };
      const result = buildSessionKeyFromDmScope({
        cfg: config,
        agentId: "TEST-AGENT",
        channel: " TEST-CHANNEL ",
        accountId: "TEST-ACCOUNT",
        peerId: " TEST-PEER "
      });
      expect(result).toBe("agent:test-agent:direct:test-peer");
    });

    it("缺失参数应使用默认值", () => {
      const config = {
        session: {
          dmScope: "per-account-channel-peer"
        }
      };
      const result = buildSessionKeyFromDmScope({
        cfg: config,
        agentId: "",
        channel: "",
        accountId: "",
        peerId: "test-peer"
      });
      expect(result).toBe("agent:main:unknown:default:direct:test-peer");
    });
  });
});