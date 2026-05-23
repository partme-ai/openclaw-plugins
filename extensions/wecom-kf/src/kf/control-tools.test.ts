/**
 * @module wecom-kf/kf/control-tools.test
 * 控制面 KF Tools 单测 — 验证 handler 行为与 LLM 上下文隔离
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { __testing } from "./control-tools.js";
import * as apiClient from "../agent/api-client.js";
import { resetServicerCacheForTests } from "../api/admin.js";

const {
    handleListServicers,
    handleListAccounts,
    handleGetAccountLink,
    handleTransferSession,
    isolatedAck,
} = __testing;

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

const kfToolCtx = {
    config: testCfg,
    messageChannel: "wecom-kf",
    agentAccountId: "wk_default",
    requesterSenderId: "wm_customer_001",
    sessionKey: "agent:main:wecom-kf:wk_default:dm:wm_customer_001",
};

describe("control-tools isolated ack", () => {
    it("isolatedAck 返回空 content", () => {
        const result = isolatedAck({ ok: true, action: "test" });
        expect(result.content).toEqual([]);
        expect(result.details).toEqual({ ok: true, action: "test" });
    });
});

describe("wecom_kf_list_servicers handler", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it("成功时 content 为空且 details 不含 servicer_list", async () => {
        vi.spyOn(apiClient, "listKfServicers").mockResolvedValue({
            errcode: 0,
            errmsg: "ok",
            servicer_list: [
                { userid: "zhangsan", status: 0 },
                { userid: "lisi", status: 1 },
            ],
        });

        const result = await handleListServicers(kfToolCtx, {});

        expect(result.content).toEqual([]);
        expect(result.details?.ok).toBe(true);
        expect(result.details?.action).toBe("list_servicers");
        expect(result.details?.count).toBe(2);
        expect(JSON.stringify(result)).not.toContain("zhangsan");
        expect(JSON.stringify(result)).not.toContain("servicer_list");
    });

    it("从会话上下文注入 open_kfid", async () => {
        const spy = vi.spyOn(apiClient, "listKfServicers").mockResolvedValue({
            errcode: 0,
            errmsg: "ok",
            servicer_list: [],
        });

        await handleListServicers(kfToolCtx, {});

        expect(spy).toHaveBeenCalledWith(
            expect.objectContaining({ openKfId: "wk_default" }),
        );
    });
});

describe("wecom_kf_list_accounts handler", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it("成功时 content 为空且不含 account_list 明细", async () => {
        vi.spyOn(apiClient, "listKfAccounts").mockResolvedValue({
            errcode: 0,
            errmsg: "ok",
            account_list: [
                { open_kfid: "wk_a", name: "售前客服", avatar: "https://example.com/a.png" },
            ],
        });

        const result = await handleListAccounts(kfToolCtx, { offset: 0, limit: 10 });

        expect(result.content).toEqual([]);
        expect(result.details?.ok).toBe(true);
        expect(result.details?.count).toBe(1);
        expect(JSON.stringify(result)).not.toContain("售前客服");
        expect(JSON.stringify(result)).not.toContain("account_list");
    });
});

describe("wecom_kf_get_account_link handler", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it("成功时 content 为空且 details 不含 url 明文", async () => {
        vi.spyOn(apiClient, "getKfAccountLink").mockResolvedValue({
            errcode: 0,
            errmsg: "ok",
            url: "https://work.weixin.qq.com/kfid/secret-link",
        });

        const result = await handleGetAccountLink(kfToolCtx, {});

        expect(result.content).toEqual([]);
        expect(result.details?.ok).toBe(true);
        expect(result.details?.hasUrl).toBe(true);
        expect(JSON.stringify(result)).not.toContain("secret-link");
    });
});

describe("wecom_kf_transfer_session handler", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        resetServicerCacheForTests();
    });

    it("转人工成功时返回最小 ack", async () => {
        vi.spyOn(apiClient, "listKfServicers").mockResolvedValue({
            errcode: 0,
            errmsg: "ok",
            servicer_list: [{ userid: "zhangsan", status: 0 }],
        });
        vi.spyOn(apiClient, "transferKfSession").mockResolvedValue({
            errcode: 0,
            errmsg: "ok",
            msg_code: "MSG_CODE_SECRET",
        });

        const result = await handleTransferSession(kfToolCtx, {
            service_state: 3,
            servicer_userid: "zhangsan",
        });

        expect(result.content).toEqual([]);
        expect(result.details).toEqual({
            ok: true,
            action: "transfer",
            serviceState: 3,
            hasMsgCode: true,
            autoSelectedServicer: false,
        });
        expect(JSON.stringify(result)).not.toContain("MSG_CODE_SECRET");
    });

    it("从会话上下文注入 open_kfid 与 external_userid", async () => {
        const spy = vi.spyOn(apiClient, "transferKfSession").mockResolvedValue({
            errcode: 0,
            errmsg: "ok",
        });

        await handleTransferSession(kfToolCtx, { service_state: 2 });

        expect(spy).toHaveBeenCalledWith(
            expect.objectContaining({
                openKfId: "wk_default",
                externalUserId: "wm_customer_001",
                serviceState: 2,
            }),
        );
    });

    it("转人工缺少 servicer_userid 且无在线坐席时返回错误 ack", async () => {
        vi.spyOn(apiClient, "listKfServicers").mockResolvedValue({
            errcode: 0,
            errmsg: "ok",
            servicer_list: [],
        });
        vi.spyOn(apiClient, "transferKfSession");
        const result = await handleTransferSession(kfToolCtx, { service_state: 3 });

        expect(result.content).toEqual([]);
        expect(result.details?.ok).toBe(false);
        expect(result.details?.error).toContain("servicer_userid");
    });
});
