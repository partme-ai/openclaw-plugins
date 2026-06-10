/**
 * WeCom 解析后账号类型（types/account）
 *
 * `ResolvedAgentAccount` 由 `accounts.resolveWeComAccountMulti` 在 agent 凭据齐全时构造，
 * 供 Agent HTTP API、webhook 注册与 probe 使用。Bot 侧仍使用 `ResolvedWeComAccount`（utils.ts）。
 */

import type {
    WecomAgentConfig,
    WecomNetworkConfig,
} from "./config.js";

/**
 * 解析后的 Agent 账号
 */
export type ResolvedAgentAccount = {
    /** 账号 ID */
    accountId: string;
    /** 是否启用 */
    enabled: boolean;
    /** 是否配置完整 */
    configured: boolean;
    /** 企业 ID */
    corpId: string;
    /** 应用 Secret */
    corpSecret: string;
    /** 应用 ID (数字，可选) */
    agentId?: number;
    /** 回调 Token */
    token: string;
    /** 回调加密密钥 */
    encodingAESKey: string;
    /** 原始配置 */
    config: WecomAgentConfig;
    /** 网络配置（来自 channels.wecom.network） */
    network?: WecomNetworkConfig;
};
