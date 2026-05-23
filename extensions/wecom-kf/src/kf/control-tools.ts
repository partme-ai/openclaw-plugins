/**
 * @module wecom-kf/kf/control-tools
 * KF 控制面 Agent Tools — API 完整响应不进入 LLM 上下文
 *
 * | Tool | 企微 API |
 * |------|----------|
 * | wecom_kf_list_servicers | 94645 获取接待人员列表 |
 * | wecom_kf_list_accounts | 94661 获取客服账号列表 |
 * | wecom_kf_get_account_link | 94665 获取客服账号链接 |
 * | wecom_kf_transfer_session | 94669 分配/转接客服会话 |
 *
 * ## 上下文隔离策略
 *
 * 1. **空 content**：execute 返回 `content: []`，OpenClaw 不会将 tool result text 注入 assistant 可见 transcript。
 * 2. **最小 ack**：业务结果摘要仅放在 `details`（如 `{ ok: true, action: "transfer" }`），供 runtime 审计。
 * 3. **完整响应写 audit 日志**：`auditLog()` 将企微 API 原始 JSON 写入 `console.log`（runtime.log），不暴露给模型。
 */

import {
    getKfAccountLink,
    listKfAccounts,
    listKfServicers,
    transferKfSession,
} from "../agent/api-client.js";
import {
    resolveKfAgentAccount,
    resolveKfCallContext,
    type OpenClawPluginToolContext,
} from "./call-context.js";

/** 控制面 tool 统一返回形态（content 空 = 不进 LLM transcript） */
export type ControlToolResult = {
    content: [];
    details: Record<string, unknown>;
};

const AUDIT_PREFIX = "[wecom_kf:audit]";

/**
 * 将完整 API 响应写入 runtime 审计日志（不进 LLM）。
 */
function auditLog(action: string, payload: unknown): void {
    console.log(`${AUDIT_PREFIX} action=${action} payload=${JSON.stringify(payload)}`);
}

/**
 * 构造不进入 LLM 上下文的 tool 结果。
 *
 * OpenClaw 将 `content[]` 注入 session transcript；空数组使模型看不到 API 明细。
 */
function isolatedAck(details: Record<string, unknown>): ControlToolResult {
    return { content: [], details };
}

function isolatedError(action: string, message: string): ControlToolResult {
    auditLog(action, { ok: false, error: message });
    return isolatedAck({ ok: false, action, error: message });
}

// ── Handlers ──

async function handleListServicers(
    toolCtx: OpenClawPluginToolContext,
    params: Record<string, unknown>,
): Promise<ControlToolResult> {
    const action = "list_servicers";
    const callCtx = resolveKfCallContext(toolCtx, params);
    const agent = resolveKfAgentAccount(toolCtx.config, callCtx.openKfId);
    if (!agent) {
        return isolatedError(action, "KF 账号未配置或缺少 corpId/corpSecret");
    }

    const data = await listKfServicers({ agent, openKfId: callCtx.openKfId });
    auditLog(action, data);

    if (data.errcode !== 0) {
        return isolatedAck({
            ok: false,
            action,
            errcode: data.errcode,
            error: data.errmsg,
        });
    }

    const count = data.servicer_list?.length ?? 0;
    return isolatedAck({ ok: true, action, count, accountKey: callCtx.accountKey });
}

async function handleListAccounts(
    toolCtx: OpenClawPluginToolContext,
    params: Record<string, unknown>,
): Promise<ControlToolResult> {
    const action = "list_accounts";
    const callCtx = resolveKfCallContext(toolCtx, params);
    const agent = resolveKfAgentAccount(toolCtx.config, callCtx.openKfId);
    if (!agent) {
        return isolatedError(action, "KF 账号未配置或缺少 corpId/corpSecret");
    }

    const offset = typeof params.offset === "number" ? params.offset : undefined;
    const limit = typeof params.limit === "number" ? params.limit : undefined;
    const data = await listKfAccounts({ agent, offset, limit });
    auditLog(action, data);

    if (data.errcode !== 0) {
        return isolatedAck({
            ok: false,
            action,
            errcode: data.errcode,
            error: data.errmsg,
        });
    }

    const count = data.account_list?.length ?? 0;
    return isolatedAck({ ok: true, action, count });
}

async function handleGetAccountLink(
    toolCtx: OpenClawPluginToolContext,
    params: Record<string, unknown>,
): Promise<ControlToolResult> {
    const action = "get_account_link";
    const callCtx = resolveKfCallContext(toolCtx, params);
    const openKfId = callCtx.openKfId;
    if (!openKfId) {
        return isolatedError(action, "缺少 open_kfid（参数或会话上下文）");
    }

    const agent = resolveKfAgentAccount(toolCtx.config, openKfId);
    if (!agent) {
        return isolatedError(action, "KF 账号未配置或缺少 corpId/corpSecret");
    }

    const scene = (params.scene as string | undefined)?.trim();
    const data = await getKfAccountLink({ agent, openKfId, scene });
    auditLog(action, data);

    if (data.errcode !== 0) {
        return isolatedAck({
            ok: false,
            action,
            errcode: data.errcode,
            error: data.errmsg,
        });
    }

    return isolatedAck({ ok: true, action, hasUrl: Boolean(data.url) });
}

async function handleTransferSession(
    toolCtx: OpenClawPluginToolContext,
    params: Record<string, unknown>,
): Promise<ControlToolResult> {
    const action = "transfer";
    const callCtx = resolveKfCallContext(toolCtx, params);
    const openKfId = callCtx.openKfId;
    const externalUserId = callCtx.externalUserId;

    if (!openKfId || !externalUserId) {
        return isolatedError(action, "缺少 open_kfid 或 external_userid（参数或会话上下文）");
    }

    const serviceState = params.service_state as number;
    if (typeof serviceState !== "number" || !Number.isFinite(serviceState)) {
        return isolatedError(action, "service_state 必须为数字");
    }

    if (serviceState === 3 && !(params.servicer_userid as string | undefined)?.trim()) {
        return isolatedError(action, "转人工(service_state=3)时必须提供 servicer_userid");
    }

    const agent = resolveKfAgentAccount(toolCtx.config, openKfId);
    if (!agent) {
        return isolatedError(action, "KF 账号未配置或缺少 corpId/corpSecret");
    }

    const data = await transferKfSession({
        agent,
        openKfId,
        externalUserId,
        serviceState,
        servicerUserId: (params.servicer_userid as string | undefined)?.trim(),
    });
    auditLog(action, data);

    if (data.errcode !== 0) {
        return isolatedAck({
            ok: false,
            action,
            errcode: data.errcode,
            error: data.errmsg,
        });
    }

    return isolatedAck({
        ok: true,
        action,
        serviceState,
        hasMsgCode: Boolean(data.msg_code),
    });
}

// ── Tool factories ──

/**
 * **wecom_kf_list_servicers** — 获取接待人员列表 (94645)
 */
export function createWecomKfListServicersTool(toolCtx: OpenClawPluginToolContext) {
    return {
        name: "wecom_kf_list_servicers",
        label: "获取接待人员列表（控制面）",
        description: "获取微信客服账号的接待人员列表。结果不进入对话上下文，仅供 runtime 审计与转人工路由使用。",
        parameters: {
            type: "object" as const,
            properties: {
                open_kfid: { type: "string", description: "客服账号 ID；省略时使用当前会话 open_kfid" },
            },
        },
        async execute(_id: string, params: Record<string, unknown>) {
            return handleListServicers(toolCtx, params);
        },
    };
}

/**
 * **wecom_kf_list_accounts** — 获取客服账号列表 (94661)
 */
export function createWecomKfListAccountsTool(toolCtx: OpenClawPluginToolContext) {
    return {
        name: "wecom_kf_list_accounts",
        label: "获取客服账号列表（控制面）",
        description: "获取企业微信客服账号列表。结果不进入对话上下文，仅供 runtime 审计使用。",
        parameters: {
            type: "object" as const,
            properties: {
                offset: { type: "number", description: "分页偏移量，默认 0" },
                limit: { type: "number", description: "每页数量，最大 100" },
            },
        },
        async execute(_id: string, params: Record<string, unknown>) {
            return handleListAccounts(toolCtx, params);
        },
    };
}

/**
 * **wecom_kf_get_account_link** — 获取客服账号链接 (94665)
 */
export function createWecomKfGetAccountLinkTool(toolCtx: OpenClawPluginToolContext) {
    return {
        name: "wecom_kf_get_account_link",
        label: "获取客服账号链接（控制面）",
        description: "获取微信客服账号咨询链接。链接详情不进入对话上下文，仅写入 runtime 审计日志。",
        parameters: {
            type: "object" as const,
            properties: {
                open_kfid: { type: "string", description: "客服账号 ID；省略时使用当前会话 open_kfid" },
                scene: { type: "string", description: "场景值，不多于 32 字节" },
            },
        },
        async execute(_id: string, params: Record<string, unknown>) {
            return handleGetAccountLink(toolCtx, params);
        },
    };
}

/**
 * **wecom_kf_transfer_session** — 分配/转接客服会话 (94669)
 */
export function createWecomKfTransferSessionTool(toolCtx: OpenClawPluginToolContext) {
    return {
        name: "wecom_kf_transfer_session",
        label: "转接客服会话（控制面）",
        description: "变更客服会话状态：转人工(3)、排队(2)、智能助手(1)、结束(4)。结果不进入对话上下文。",
        parameters: {
            type: "object" as const,
            properties: {
                open_kfid: { type: "string", description: "客服账号 ID；省略时使用当前会话" },
                external_userid: { type: "string", description: "微信客户 ID；省略时使用当前会话" },
                service_state: {
                    type: "number",
                    description: "目标状态：1=智能助手, 2=待接入池, 3=人工接待, 4=结束会话",
                },
                servicer_userid: { type: "string", description: "接待人员 userid，转人工(state=3) 时必填" },
            },
            required: ["service_state"],
        },
        async execute(_id: string, params: Record<string, unknown>) {
            return handleTransferSession(toolCtx, params);
        },
    };
}

/** 导出 handler 供单测 */
export const __testing = {
    handleListServicers,
    handleListAccounts,
    handleGetAccountLink,
    handleTransferSession,
    isolatedAck,
    auditLog,
};
