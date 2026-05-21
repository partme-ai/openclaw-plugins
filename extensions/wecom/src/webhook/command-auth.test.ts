/**
 * command-auth + group-policy + const 单元测试
 */
import { describe, it, expect } from "vitest";
import { buildWecomUnauthorizedCommandPrompt } from "./command-auth.js";
import { isSenderAllowed, checkGroupPolicy } from "../group-policy.ts";
import {
  CHANNEL_ID,
  VALID_CARD_TYPES,
  WEBHOOK_PATHS,
  API_ENDPOINTS,
  LIMITS,
  CRYPTO,
  IMAGE_MAX_BYTES,
  VIDEO_MAX_BYTES,
  VOICE_MAX_BYTES,
  FILE_MAX_BYTES,
  MESSAGE_PROCESS_TIMEOUT_MS,
  WS_MAX_RECONNECT_ATTEMPTS,
  TEMPLATE_CARD_CACHE_TTL_MS,
} from "../const.ts";
import type { ResolvedWeComAccount, WeComConfig } from "../utils.ts";

// ============================================================================
// buildWecomUnauthorizedCommandPrompt
// ============================================================================

describe("buildWecomUnauthorizedCommandPrompt", () => {
  it("disabled 策略", () => {
    const p = buildWecomUnauthorizedCommandPrompt({
      senderUserId: "user1", dmPolicy: "disabled", scope: "bot",
    });
    expect(p).toContain("dmPolicy=disabled");
    expect(p).toContain("user1");
    expect(p).toContain("Bot（智能机器人）");
  });

  it("allowlist 策略", () => {
    const p = buildWecomUnauthorizedCommandPrompt({
      senderUserId: "user2", dmPolicy: "allowlist", scope: "agent",
    });
    expect(p).toContain("user2");
    expect(p).toContain("Agent（自建应用）");
    expect(p).toContain("openclaw config set");
  });

  it("open 策略（理论上不会走到这里但文案仍然可用）", () => {
    const p = buildWecomUnauthorizedCommandPrompt({
      senderUserId: "u3", dmPolicy: "open", scope: "bot",
    });
    expect(p).toContain("u3");
    expect(p).toContain("channels.wecom.bot");
  });

  it("空 userid", () => {
    const p = buildWecomUnauthorizedCommandPrompt({
      senderUserId: "", dmPolicy: "disabled", scope: "bot",
    });
    expect(p).toContain("unknown");
  });
});

// ============================================================================
// isSenderAllowed
// ============================================================================

describe("isSenderAllowed", () => {
  it("通配符 * 允许所有人", () => {
    expect(isSenderAllowed("anyone", ["*"])).toBe(true);
  });

  it("精确匹配", () => {
    expect(isSenderAllowed("user1", ["user1", "user2"])).toBe(true);
  });

  it("不匹配", () => {
    expect(isSenderAllowed("user3", ["user1", "user2"])).toBe(false);
  });

  it("user: 前缀", () => {
    expect(isSenderAllowed("user1", ["user:user1"])).toBe(true);
  });

  it("wecom: 渠道前缀被剥离", () => {
    expect(isSenderAllowed("user1", ["wecom:user1"])).toBe(true);
  });

  it("大小写敏感 — senderId 和条目都区分大小写", () => {
    expect(isSenderAllowed("User1", ["User1"])).toBe(true);
    expect(isSenderAllowed("user1", ["User1"])).toBe(false);
    expect(isSenderAllowed("User1", ["user1"])).toBe(false);
  });

  it("空列表拒绝", () => {
    expect(isSenderAllowed("user1", [])).toBe(false);
  });
});

// ============================================================================
// checkGroupPolicy
// ============================================================================

describe("checkGroupPolicy", () => {
  const baseAccount: ResolvedWeComAccount = {
    accountId: "acct1",
    name: "test",
    enabled: true,
    websocketUrl: "wss://test",
    botId: "bot1",
    secret: "s1",
    sendThinkingMessage: true,
    config: {} as WeComConfig,
  };

  const runtime = { log: () => {}, error: () => {} } as any;

  it("open 策略允许任意群组", () => {
    const account = {
      ...baseAccount,
      config: { groupPolicy: "open" as const },
    };
    const result = checkGroupPolicy({
      chatId: "any-group", senderId: "anyone",
      account, config: {} as any, runtime,
    });
    expect(result.allowed).toBe(true);
  });

  it("disabled 策略拒绝所有", () => {
    const account = {
      ...baseAccount,
      config: { groupPolicy: "disabled" as const },
    };
    const result = checkGroupPolicy({
      chatId: "g1", senderId: "u1",
      account, config: {} as any, runtime,
    });
    expect(result.allowed).toBe(false);
  });

  it("allowlist — 群组在白名单中", () => {
    const account = {
      ...baseAccount,
      config: {
        groupPolicy: "allowlist" as const,
        groupAllowFrom: ["g1", "g2"],
      },
    };
    const result = checkGroupPolicy({
      chatId: "g1", senderId: "u1",
      account, config: {} as any, runtime,
    });
    expect(result.allowed).toBe(true);
  });

  it("allowlist — 群组不在白名单中", () => {
    const account = {
      ...baseAccount,
      config: {
        groupPolicy: "allowlist" as const,
        groupAllowFrom: ["g1"],
      },
    };
    const result = checkGroupPolicy({
      chatId: "g3", senderId: "u1",
      account, config: {} as any, runtime,
    });
    expect(result.allowed).toBe(false);
  });

  it("群组白名单含通配符 *", () => {
    const account = {
      ...baseAccount,
      config: {
        groupPolicy: "allowlist" as const,
        groupAllowFrom: ["*"],
      },
    };
    const result = checkGroupPolicy({
      chatId: "any-group", senderId: "u1",
      account, config: {} as any, runtime,
    });
    expect(result.allowed).toBe(true);
  });

  it("群组允许但发送者在群内白名单外", () => {
    const account = {
      ...baseAccount,
      config: {
        groupPolicy: "open" as const,
        groups: {
          "g1": { allowFrom: ["admin1"] },
        },
      },
    };
    const result = checkGroupPolicy({
      chatId: "g1", senderId: "normal-user",
      account, config: {} as any, runtime,
    });
    expect(result.allowed).toBe(false);
  });

  it("群内发送者白名单含 * 通配", () => {
    const account = {
      ...baseAccount,
      config: {
        groupPolicy: "open" as const,
        groups: {
          "g1": { allowFrom: ["*"] },
        },
      },
    };
    const result = checkGroupPolicy({
      chatId: "g1", senderId: "anyone",
      account, config: {} as any, runtime,
    });
    expect(result.allowed).toBe(true);
  });
});

// ============================================================================
// 常量验证
// ============================================================================

describe("CHANNEL_ID", () => {
  it("是 wecom", () => {
    expect(CHANNEL_ID).toBe("wecom");
  });
});

describe("VALID_CARD_TYPES", () => {
  it("包含 5 种卡片类型", () => {
    expect(VALID_CARD_TYPES).toHaveLength(5);
    expect(VALID_CARD_TYPES).toContain("text_notice");
    expect(VALID_CARD_TYPES).toContain("news_notice");
    expect(VALID_CARD_TYPES).toContain("button_interaction");
    expect(VALID_CARD_TYPES).toContain("vote_interaction");
    expect(VALID_CARD_TYPES).toContain("multiple_interaction");
  });
});

describe("WEBHOOK_PATHS", () => {
  it("所有路径以 / 开头", () => {
    for (const p of Object.values(WEBHOOK_PATHS)) {
      expect(p.startsWith("/")).toBe(true);
    }
  });
});

describe("API_ENDPOINTS", () => {
  it("所有端点是有效 URL", () => {
    for (const url of Object.values(API_ENDPOINTS)) {
      expect(url.startsWith("https://qyapi.weixin.qq.com")).toBe(true);
    }
  });
});

describe("LIMITS", () => {
  it("超时和大小限制是正数", () => {
    expect(LIMITS.TEXT_MAX_BYTES).toBeGreaterThan(0);
    expect(LIMITS.REQUEST_TIMEOUT_MS).toBeGreaterThan(0);
    expect(LIMITS.TOKEN_REFRESH_BUFFER_MS).toBeGreaterThan(0);
  });
});

describe("CRYPTO", () => {
  it("加密常量合理性", () => {
    expect(CRYPTO.PKCS7_BLOCK_SIZE).toBe(32);
    expect(CRYPTO.AES_KEY_LENGTH).toBe(32);
  });
});

describe("媒体大小限制", () => {
  it("image < video < file 合理分层", () => {
    expect(IMAGE_MAX_BYTES).toBe(10 * 1024 * 1024);
    expect(VIDEO_MAX_BYTES).toBe(10 * 1024 * 1024);
    expect(VOICE_MAX_BYTES).toBe(2 * 1024 * 1024);
    expect(FILE_MAX_BYTES).toBe(20 * 1024 * 1024);
  });
});

describe("超时/重试配置", () => {
  it("消息处理超时 6 分钟", () => {
    expect(MESSAGE_PROCESS_TIMEOUT_MS).toBe(6 * 60 * 1000);
  });

  it("WebSocket 最多重连 10 次", () => {
    expect(WS_MAX_RECONNECT_ATTEMPTS).toBe(10);
  });

  it("模板卡片缓存 24 小时", () => {
    expect(TEMPLATE_CARD_CACHE_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });
});
