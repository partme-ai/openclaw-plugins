/**
 * @module wecom-kf/kf/call-context
 * KF Tool 调用上下文解析 — 从 OpenClawPluginToolContext 与会话参数注入 open_kfid / external_userid
 */

import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { ResolvedAgentAccount } from "../types/index.js";
import { resolveKfAccountByOpenKfId, WECOM_KF_CHANNEL_ID } from "../config/accounts.js";

/** OpenClaw registerTool 工厂上下文（plugin-sdk 子集） */
export type OpenClawPluginToolContext = {
    config?: OpenClawConfig;
    messageChannel?: string;
    requesterSenderId?: string | null;
    agentAccountId?: string | null;
    sessionKey?: string | null;
};

/** KF Tool 运行时调用上下文 */
export type KfCallContext = {
    /** 企微客服 open_kfid */
    openKfId?: string;
    /** 微信客户 external_userid */
    externalUserId?: string;
    /** 配置键 channels.wecom-kf.accounts.{accountKey} */
    accountKey?: string;
};

/**
 * 从 tool 参数与 OpenClaw 会话上下文合并 KF 调用上下文。
 *
 * wecom-kf 渠道入站路由将 `agentAccountId` 设为 open_kfid，`requesterSenderId` 设为 external_userid。
 */
export function resolveKfCallContext(
    toolCtx: OpenClawPluginToolContext,
    params: Record<string, unknown>,
): KfCallContext {
    const isKfChannel = toolCtx.messageChannel === WECOM_KF_CHANNEL_ID;
    const paramOpenKfId = (params.open_kfid as string | undefined)?.trim();
    const paramExternalUserId = (params.external_userid as string | undefined)?.trim();
    const ctxOpenKfId = isKfChannel ? toolCtx.agentAccountId?.trim() : undefined;
    const ctxExternalUserId = isKfChannel ? toolCtx.requesterSenderId?.trim() : undefined;

    const openKfId = paramOpenKfId || ctxOpenKfId || undefined;
    const externalUserId = paramExternalUserId || ctxExternalUserId || undefined;

    const cfg = toolCtx.config;
    const accountKey = cfg && openKfId
        ? resolveKfAccountByOpenKfId({ cfg, openKfId })?.accountKey
        : undefined;

    return { openKfId, externalUserId, accountKey };
}

/**
 * 按 open_kfid 解析 KF API 所需的 ResolvedAgentAccount（corpId + corpSecret）。
 */
export function resolveKfAgentAccount(
    cfg: OpenClawConfig | undefined,
    openKfId?: string,
): ResolvedAgentAccount | undefined {
    if (!cfg) return undefined;

    const kfResolved = resolveKfAccountByOpenKfId({ cfg, openKfId: openKfId ?? null });
    if (!kfResolved) return undefined;

    const corpId = (kfResolved.config.corpId ?? kfResolved.config.agent?.corpId ?? "").trim();
    const corpSecret = (kfResolved.config.corpSecret ?? kfResolved.config.agent?.corpSecret ?? "").trim();
    if (!corpId || !corpSecret) return undefined;

    return {
        accountId: kfResolved.accountKey,
        enabled: true,
        configured: true,
        corpId,
        corpSecret,
        token: kfResolved.config.token ?? "",
        encodingAESKey: kfResolved.config.encodingAESKey ?? "",
        config: {
            ...(kfResolved.config.agent ?? {
                corpId,
                corpSecret,
                token: kfResolved.config.token ?? "",
                encodingAESKey: kfResolved.config.encodingAESKey ?? "",
            }),
            apiBaseUrl: kfResolved.config.apiBaseUrl,
        },
    };
}
