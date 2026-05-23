/**
 * @module wecom-kf/kf/call-context.test
 */

import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { resolveKfCallContext, resolveKfAgentAccount } from "./call-context.js";

const testCfg = {
    channels: {
        "wecom-kf": {
            defaultAccount: "default",
            accounts: {
                default: {
                    openKfId: "wk_default",
                    agentId: "agent-main",
                    corpId: "ww_test",
                    corpSecret: "secret_test",
                    token: "token",
                    encodingAESKey: "aeskey123456789012345678901234",
                },
            },
        },
    },
} as unknown as OpenClawConfig;

describe("resolveKfCallContext", () => {
    it("wecom-kf 渠道从会话上下文注入 open_kfid 与 external_userid", () => {
        const ctx = resolveKfCallContext(
            {
                config: testCfg,
                messageChannel: "wecom-kf",
                agentAccountId: "wk_default",
                requesterSenderId: "wm_customer_001",
            },
            {},
        );

        expect(ctx.openKfId).toBe("wk_default");
        expect(ctx.externalUserId).toBe("wm_customer_001");
        expect(ctx.accountKey).toBe("default");
    });

    it("参数优先于会话上下文", () => {
        const ctx = resolveKfCallContext(
            {
                config: testCfg,
                messageChannel: "wecom-kf",
                agentAccountId: "wk_default",
                requesterSenderId: "wm_customer_001",
            },
            { open_kfid: "wk_override", external_userid: "wm_override" },
        );

        expect(ctx.openKfId).toBe("wk_override");
        expect(ctx.externalUserId).toBe("wm_override");
    });

    it("非 wecom-kf 渠道不自动注入会话字段", () => {
        const ctx = resolveKfCallContext(
            {
                config: testCfg,
                messageChannel: "telegram",
                agentAccountId: "wk_default",
                requesterSenderId: "user123",
            },
            {},
        );

        expect(ctx.openKfId).toBeUndefined();
        expect(ctx.externalUserId).toBeUndefined();
    });
});

describe("resolveKfAgentAccount", () => {
    it("按 open_kfid 解析 corp 凭据", () => {
        const agent = resolveKfAgentAccount(testCfg, "wk_default");
        expect(agent?.corpId).toBe("ww_test");
        expect(agent?.corpSecret).toBe("secret_test");
        expect(agent?.accountId).toBe("default");
    });
});
