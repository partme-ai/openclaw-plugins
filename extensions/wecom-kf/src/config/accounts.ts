/**
 * WeCom KF 账号解析与模式检测
 * 渠道键：channels.wecom-kf（独立于 wecom / wecom-cs）
 */

import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { mergeChannelAccountConfig } from "@partme.ai/openclaw-message-sdk/config";
import type {
    WecomConfig,
    WecomKfConfig,
    WecomKfAccountConfig,
    WecomAccountConfig,
    WecomBotConfig,
    WecomAgentConfig,
    WecomNetworkConfig,
    ResolvedWecomAccount,
    ResolvedBotAccount,
    ResolvedAgentAccount,
    ResolvedMode,
    ResolvedWecomAccounts,
} from "../types/index.js";

/** wecom-kf 渠道 ID，与 OpenClaw bindings.match.channel 对齐 */
export const WECOM_KF_CHANNEL_ID = "wecom-kf";

export const DEFAULT_ACCOUNT_ID = "default";

/** 按 open_kfid 解析后的 KF 账号（一账号一 Agent） */
export type ResolvedKfAccount = {
    /** 配置键 channels.wecom-kf.accounts.{accountKey} */
    accountKey: string;
    /** 绑定的 OpenClaw Agent id */
    agentId: string;
    /** 企微客服 open_kfid */
    openKfId: string;
    /** 合并后的 flat 配置（供 callback / handler 使用） */
    config: WecomAccountConfig;
};

export type CustomAgentAccountConfig = {
    openKfId?: string;
    agentId?: string;
    agentMapping?: Record<string, string>;
};

export type CustomAgentMappingsConfig = {
    accounts?: Record<string, CustomAgentAccountConfig>;
};

export type AccountMapping = {
    name?: string;
    avatar?: string;
    agentId?: string;
};

export type ServicerInfo = {
    userid: string;
    status: number;
    department_id?: number;
};

const customAgentMappings: Record<string, string> = {};
const accountMappings = new Map<string, AccountMapping>();
const servicerCache = new Map<string, ServicerInfo[]>();

export function loadCustomAgentMappings(config: CustomAgentMappingsConfig): void {
    for (const key of Object.keys(customAgentMappings)) {
        delete customAgentMappings[key];
    }

    for (const account of Object.values(config.accounts ?? {})) {
        registerCustomAgentMappingsForAccount(account);
    }
}

/**
 * 从 openclaw.json channels.wecom-kf 加载 open_kfid → Agent 映射
 */
export function loadKfAgentMappingsFromConfig(cfg: OpenClawConfig): void {
    const block = getWecomKfBlock(cfg);
    if (!block) {
        loadCustomAgentMappings({ accounts: {} });
        return;
    }

    const accounts: Record<string, CustomAgentAccountConfig> = {};
    const matrix = block.accounts;
    if (matrix && Object.keys(matrix).length > 0) {
        for (const [accountKey, entry] of Object.entries(matrix)) {
            if (!entry) continue;
            const merged = mergeKfAccountEntry(block, entry);
            accounts[accountKey] = {
                openKfId: merged.openKfId,
                agentId: merged.agentId,
                agentMapping: merged.agentMapping,
            };
        }
    } else {
        const legacy = applyKfEnvVarFallback(flattenKfFields(block), DEFAULT_ACCOUNT_ID);
        accounts[DEFAULT_ACCOUNT_ID] = {
            openKfId: legacy.openKfId as string | undefined,
            agentId: legacy.agentId as string | undefined,
            agentMapping: legacy.agentMapping as Record<string, string> | undefined,
        };
    }

    loadCustomAgentMappings({ accounts });
}

function registerCustomAgentMappingsForAccount(account: CustomAgentAccountConfig): void {
    const openKfId = account.openKfId?.trim();
    const defaultAgentId = account.agentId?.trim();
    if (openKfId && defaultAgentId) {
        customAgentMappings[openKfId] = defaultAgentId;
    }

    for (const [key, agentId] of Object.entries(account.agentMapping ?? {})) {
        const normalizedKey = key.trim();
        const normalizedAgentId = agentId.trim();
        if (normalizedKey && normalizedAgentId) {
            customAgentMappings[normalizedKey] = normalizedAgentId;
        }
    }
}

function getWecomKfBlock(cfg: OpenClawConfig): WecomKfConfig | undefined {
    return cfg.channels?.[WECOM_KF_CHANNEL_ID] as WecomKfConfig | undefined;
}

function flattenKfFields(source: Record<string, unknown>): Record<string, unknown> {
    const kf = source.kf as Record<string, unknown> | undefined;
    return {
        ...source,
        ...(kf ?? {}),
    };
}

function mergeKfAccountEntry(
    block: WecomKfConfig,
    entry: WecomKfAccountConfig,
): WecomAccountConfig {
    const { accounts: _accounts, defaultAccount: _defaultAccount, ...base } = block;
    const merged = mergeChannelAccountConfig(
        flattenKfFields(base as Record<string, unknown>),
        flattenKfFields(entry as unknown as Record<string, unknown>),
        ["eventMessages"],
    );
    return merged as unknown as WecomAccountConfig;
}

function isKfAccountConfigured(config: WecomAccountConfig): boolean {
    return Boolean(
        config.corpId?.trim() &&
            config.token?.trim() &&
            config.encodingAESKey?.trim() &&
            config.openKfId?.trim() &&
            config.agentId?.trim(),
    );
}

function toResolvedKfAccountFromWecomAccount(
    accountKey: string,
    account: ResolvedWecomAccount,
): ResolvedKfAccount | undefined {
    const agentId = account.config.agentId?.trim();
    const openKfId = account.config.openKfId?.trim();
    if (!agentId || !openKfId) {
        return undefined;
    }
    return {
        accountKey,
        agentId,
        openKfId,
        config: account.config,
    };
}

export function getCustomAgentMappings(): Record<string, string> {
    return { ...customAgentMappings };
}

export function setCustomAgentMapping(openKfId: string, agentId: string): void {
    const normalizedKfId = openKfId.trim();
    const normalizedAgentId = agentId.trim();
    if (!normalizedKfId || !normalizedAgentId) return;
    customAgentMappings[normalizedKfId] = normalizedAgentId;
}

export function registerAccountMapping(openKfId: string, mapping: AccountMapping): void {
    const normalizedKfId = openKfId.trim();
    if (!normalizedKfId) return;
    accountMappings.set(normalizedKfId, { ...mapping });
}

export function getAccountMapping(openKfId: string): AccountMapping | undefined {
    const mapping = accountMappings.get(openKfId.trim());
    return mapping ? { ...mapping } : undefined;
}

export function cacheServicers(openKfId: string, servicers: ServicerInfo[]): void {
    const normalizedKfId = openKfId.trim();
    if (!normalizedKfId) return;
    servicerCache.set(normalizedKfId, servicers.map((servicer) => ({ ...servicer })));
}

export function getCachedServicers(openKfId: string): ServicerInfo[] {
    return (servicerCache.get(openKfId.trim()) ?? []).map((servicer) => ({ ...servicer }));
}

export function getOnlineServicers(openKfId: string): ServicerInfo[] {
    return getCachedServicers(openKfId).filter((servicer) => servicer.status === 0);
}

export type WecomAccountConflict = {
    type: "duplicate_bot_token" | "duplicate_bot_aibotid" | "duplicate_agent_id";
    accountId: string;
    ownerAccountId: string;
    message: string;
};

/**
 * 检测 KF 配置模式：matrix（多账号）或 legacy（单账号顶层）
 */
export function detectMode(config: WecomKfConfig | WecomConfig | undefined): ResolvedMode {
    if (!config || config.enabled === false) return "disabled";

    const accounts = config.accounts;
    if (accounts && typeof accounts === "object") {
        const enabledEntries = Object.values(accounts).filter(
            (entry) => entry && entry.enabled !== false,
        );
        if (enabledEntries.length > 0) return "matrix";
    }

    return "legacy";
}

/**
 * 解析 Bot 模式账号
 */
function resolveBotAccount(accountId: string, config: WecomBotConfig, network?: WecomNetworkConfig): ResolvedBotAccount {
    const connectionMode = config.connectionMode ?? 'webhook';
    const configured = connectionMode === 'websocket'
        ? Boolean(config.botId && config.secret)
        : Boolean(config.token && config.encodingAESKey);
    return {
        accountId,
        enabled: true,
        configured,
        token: config.token ?? "",
        encodingAESKey: config.encodingAESKey ?? "",
        receiveId: config.receiveId?.trim() ?? "",
        config,
        network,
        connectionMode,
        botId: config.botId,
        secret: config.secret,
    };
}

/**
 * 解析 Agent 模式账号
 */
function resolveAgentAccount(accountId: string, config: WecomAgentConfig, network?: WecomNetworkConfig): ResolvedAgentAccount {
    const agentIdRaw = config.agentId;
    const agentId = agentIdRaw == null
        ? undefined
        : (typeof agentIdRaw === "number" ? agentIdRaw : Number(agentIdRaw));
    const normalizedAgentId = Number.isFinite(agentId) ? agentId : undefined;

    return {
        accountId,
        enabled: true,
        configured: Boolean(
            config.corpId && config.corpSecret &&
            config.token && config.encodingAESKey
        ),
        corpId: config.corpId,
        corpSecret: config.corpSecret,
        agentId: normalizedAgentId,
        token: config.token,
        encodingAESKey: config.encodingAESKey,
        config,
        network,
    };
}

function toResolvedAccount(params: {
    accountId: string;
    enabled: boolean;
    name?: string;
    config: WecomAccountConfig;
    network?: WecomNetworkConfig;
}): ResolvedWecomAccount {
    const bot = params.config.bot
        ? resolveBotAccount(params.accountId, params.config.bot, params.network)
        : undefined;
    const agent = params.config.agent
        ? resolveAgentAccount(params.accountId, params.config.agent, params.network)
        : undefined;
    const configured = Boolean(bot?.configured || agent?.configured);
    return {
        accountId: params.accountId,
        name: params.name,
        enabled: params.enabled,
        configured,
        config: params.config,
        bot,
        agent,
    };
}

function resolveMatrixAccounts(wecomKf: WecomKfConfig): Record<string, ResolvedWecomAccount> {
    const accounts = wecomKf.accounts;
    if (!accounts || typeof accounts !== "object") return {};

    const resolved: Record<string, ResolvedWecomAccount> = {};
    for (const [rawId, entry] of Object.entries(accounts)) {
        const accountId = rawId.trim();
        if (!accountId || !entry) continue;
        const enabled = wecomKf.enabled !== false && entry.enabled !== false;

        // Legacy bot/agent 条目（与 KF 字段可共存，测试与历史路径保留）
        if (entry.bot || entry.agent) {
            const config: WecomAccountConfig = {
                enabled: entry.enabled,
                name: entry.name,
                bot: entry.bot,
                agent: entry.agent,
                openKfId: entry.openKfId,
                agentId: entry.agentId,
                agentMapping: entry.agentMapping,
                corpId: entry.corpId,
                corpSecret: entry.corpSecret,
                token: entry.token,
                encodingAESKey: entry.encodingAESKey,
            };
            resolved[accountId] = toResolvedAccount({
                accountId,
                enabled,
                name: entry.name,
                config,
                network: wecomKf.network,
            });
            continue;
        }

        let config = mergeKfAccountEntry(wecomKf, entry);
        config = applyKfEnvVarFallback(
            config as unknown as Record<string, unknown>,
            accountId,
        ) as WecomAccountConfig;
        resolved[accountId] = {
            accountId,
            name: entry.name,
            enabled,
            configured: isKfAccountConfigured(config),
            config,
        };
    }
    return resolved;
}

function resolveLegacyAccounts(wecomKf: WecomKfConfig): Record<string, ResolvedWecomAccount> {
    if (wecomKf.bot || wecomKf.agent) {
        const config: WecomAccountConfig = {
            bot: wecomKf.bot,
            agent: wecomKf.agent,
        };
        return {
            [DEFAULT_ACCOUNT_ID]: toResolvedAccount({
                accountId: DEFAULT_ACCOUNT_ID,
                enabled: wecomKf.enabled !== false,
                config,
                network: wecomKf.network,
            }),
        };
    }

    let config = applyKfEnvVarFallback(
        flattenKfFields(wecomKf as unknown as Record<string, unknown>),
        DEFAULT_ACCOUNT_ID,
    ) as WecomAccountConfig;
    return {
        [DEFAULT_ACCOUNT_ID]: {
            accountId: DEFAULT_ACCOUNT_ID,
            enabled: wecomKf.enabled !== false,
            configured: isKfAccountConfigured(config),
            config,
        },
    };
}

function normalizeDuplicateKey(value: string): string {
    return value.trim().toLowerCase();
}

function formatBotTokenConflict(params: { accountId: string; ownerAccountId: string }): WecomAccountConflict {
    return {
        type: "duplicate_bot_token",
        accountId: params.accountId,
        ownerAccountId: params.ownerAccountId,
        message:
            `Duplicate WeCom bot token: account "${params.accountId}" shares a token with account "${params.ownerAccountId}". ` +
            "Keep one owner account per bot token.",
    };
}

function formatBotAibotidConflict(params: { accountId: string; ownerAccountId: string }): WecomAccountConflict {
    return {
        type: "duplicate_bot_aibotid",
        accountId: params.accountId,
        ownerAccountId: params.ownerAccountId,
        message:
            `Duplicate WeCom bot aibotid: account "${params.accountId}" shares aibotid with account "${params.ownerAccountId}". ` +
            "Keep one owner account per aibotid.",
    };
}

function formatAgentIdConflict(params: { accountId: string; ownerAccountId: string; corpId: string; agentId: number }): WecomAccountConflict {
    return {
        type: "duplicate_agent_id",
        accountId: params.accountId,
        ownerAccountId: params.ownerAccountId,
        message:
            `Duplicate WeCom agent identity: account "${params.accountId}" shares corpId/agentId (${params.corpId}/${params.agentId}) with account "${params.ownerAccountId}". ` +
            "Keep one owner account per corpId/agentId pair.",
    };
}

function collectWecomAccountConflicts(cfg: OpenClawConfig): Map<string, WecomAccountConflict> {
    const resolved = resolveWecomAccounts(cfg);
    const conflicts = new Map<string, WecomAccountConflict>();
    const botTokenOwners = new Map<string, string>();
    const botAibotidOwners = new Map<string, string>();
    const agentOwners = new Map<string, string>();

    const accountIds = Object.keys(resolved.accounts).sort((a, b) => a.localeCompare(b));
    for (const accountId of accountIds) {
        const account = resolved.accounts[accountId];
        if (!account || account.enabled === false) {
            continue;
        }
        const bot = account.bot;
        const agent = account.agent;

        const botToken = bot?.token?.trim();
        if (botToken) {
            const key = normalizeDuplicateKey(botToken);
            const owner = botTokenOwners.get(key);
            if (owner && owner !== accountId) {
                conflicts.set(accountId, formatBotTokenConflict({ accountId, ownerAccountId: owner }));
            } else {
                botTokenOwners.set(key, accountId);
            }
        }

        const botAibotid = bot?.config.aibotid?.trim();
        if (botAibotid) {
            const key = normalizeDuplicateKey(botAibotid);
            const owner = botAibotidOwners.get(key);
            if (owner && owner !== accountId) {
                conflicts.set(accountId, formatBotAibotidConflict({ accountId, ownerAccountId: owner }));
            } else {
                botAibotidOwners.set(key, accountId);
            }
        }

        const corpId = agent?.corpId?.trim();
        const agentId = agent?.agentId;
        if (corpId && typeof agentId === "number" && Number.isFinite(agentId)) {
            const key = `${normalizeDuplicateKey(corpId)}:${agentId}`;
            const owner = agentOwners.get(key);
            if (owner && owner !== accountId) {
                conflicts.set(accountId, formatAgentIdConflict({ accountId, ownerAccountId: owner, corpId, agentId }));
            } else {
                agentOwners.set(key, accountId);
            }
        }
    }

    return conflicts;
}

export function resolveWecomAccountConflict(params: {
    cfg: OpenClawConfig;
    accountId: string;
}): WecomAccountConflict | undefined {
    return collectWecomAccountConflicts(params.cfg).get(params.accountId);
}

export function listWecomAccountIds(cfg: OpenClawConfig): string[] {
    const wecomKf = getWecomKfBlock(cfg);
    const mode = detectMode(wecomKf);
    if (mode === "matrix" && wecomKf?.accounts) {
        const ids = Object.keys(wecomKf.accounts)
            .map((id) => id.trim())
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b));
        if (ids.length > 0) return ids;
    }
    return [DEFAULT_ACCOUNT_ID];
}

/** KF 多账号 ID 列表（与 listWecomAccountIds 等价，语义更清晰） */
export const listKfAccountIds = listWecomAccountIds;

export function resolveDefaultWecomAccountId(cfg: OpenClawConfig): string {
    const wecomKf = getWecomKfBlock(cfg);
    const ids = listWecomAccountIds(cfg);
    const preferred = wecomKf?.defaultAccount?.trim();
    if (preferred && ids.includes(preferred)) return preferred;
    return ids[0] ?? DEFAULT_ACCOUNT_ID;
}

/** KF 默认账号键 */
export const resolveDefaultKfAccountId = resolveDefaultWecomAccountId;

export function resolveWecomAccount(params: {
    cfg: OpenClawConfig;
    accountId?: string | null;
}): ResolvedWecomAccount {
    const resolved = resolveWecomAccounts(params.cfg);
    const fallbackId = resolved.defaultAccountId;
    const requestedId = params.accountId?.trim();
    if (requestedId) {
        return (
            resolved.accounts[requestedId] ??
            toResolvedAccount({
                accountId: requestedId,
                enabled: false,
                config: {},
            })
        );
    }
    return (
        resolved.accounts[fallbackId] ??
        resolved.accounts[DEFAULT_ACCOUNT_ID] ??
        toResolvedAccount({
            accountId: fallbackId,
            enabled: false,
            config: {},
        })
    );
}

/**
 * 解析 WeCom KF 账号集合
 */
export function resolveWecomAccounts(cfg: OpenClawConfig): ResolvedWecomAccounts {
    const wecomKf = getWecomKfBlock(cfg);

    if (!wecomKf || wecomKf.enabled === false) {
        return {
            mode: "disabled",
            defaultAccountId: DEFAULT_ACCOUNT_ID,
            accounts: {},
        };
    }

    const mode = detectMode(wecomKf);
    const accounts =
        mode === "matrix" ? resolveMatrixAccounts(wecomKf) : resolveLegacyAccounts(wecomKf);
    const defaultAccountId = resolveDefaultWecomAccountId(cfg);
    const defaultAccount = accounts[defaultAccountId] ?? accounts[DEFAULT_ACCOUNT_ID];

    return {
        mode,
        defaultAccountId,
        accounts,
        bot: defaultAccount?.bot,
        agent: defaultAccount?.agent,
    };
}

/**
 * 按 open_kfid 解析 KF 账号 → accountKey + agentId + 合并配置
 *
 * @param params.cfg - OpenClaw 配置
 * @param params.openKfId - 回调/sync_msg 中的 open_kfid；省略时返回 defaultAccount
 */
export function resolveKfAccountByOpenKfId(params: {
    cfg: OpenClawConfig;
    openKfId?: string | null;
}): ResolvedKfAccount | undefined {
    const resolved = resolveWecomAccounts(params.cfg);
    const normalizedOpenKfId = params.openKfId?.trim();

    if (normalizedOpenKfId) {
        for (const [accountKey, account] of Object.entries(resolved.accounts)) {
            if (account.enabled === false) continue;
            if (account.config.openKfId?.trim() === normalizedOpenKfId) {
                return toResolvedKfAccountFromWecomAccount(accountKey, account);
            }
        }
        return undefined;
    }

    const defaultKey = resolved.defaultAccountId;
    const defaultAccount = resolved.accounts[defaultKey] ?? resolved.accounts[DEFAULT_ACCOUNT_ID];
    if (!defaultAccount || defaultAccount.enabled === false) {
        return undefined;
    }
    return toResolvedKfAccountFromWecomAccount(defaultAccount.accountId, defaultAccount);
}

/**
 * 创建 callback 层使用的 getAccountConfig(openKfId) 解析器
 */
export function createKfAccountConfigResolver(
    cfg: OpenClawConfig,
): (openKfId?: string) => WecomAccountConfig | undefined {
    return (openKfId?: string) =>
        resolveKfAccountByOpenKfId({ cfg, openKfId })?.config ??
        resolveKfAccountByOpenKfId({ cfg, openKfId: null })?.config;
}

/**
 * 检查是否有任何模式启用
 */
export function isWecomEnabled(cfg: OpenClawConfig): boolean {
    const resolved = resolveWecomAccounts(cfg);
    return Object.values(resolved.accounts).some((account) => account.configured && account.enabled);
}

/**
 * **KF 环境变量回退**
 *
 * 当 DEFAULT_ACCOUNT_ID 的 KF 配置缺失时，回退到环境变量。
 * 支持的变量：WECOM_KF_CORP_ID, WECOM_KF_CORP_SECRET, WECOM_KF_OPEN_KF_ID,
 *              WECOM_KF_TOKEN, WECOM_KF_ENCODING_AES_KEY
 * 从 research/openclaw-china 回移植。
 */
export function applyKfEnvVarFallback(
  accountConfig: Record<string, unknown>,
  accountId: string,
): Record<string, unknown> {
  if (accountId !== DEFAULT_ACCOUNT_ID) return accountConfig;

  const result = { ...accountConfig };
  if (!result.corpId) result.corpId = process.env.WECOM_KF_CORP_ID?.trim();
  if (!result.corpSecret) result.corpSecret = process.env.WECOM_KF_CORP_SECRET?.trim();
  if (!result.openKfId) result.openKfId = process.env.WECOM_KF_OPEN_KF_ID?.trim();
  if (!result.token) result.token = process.env.WECOM_KF_TOKEN?.trim();
  if (!result.encodingAESKey) result.encodingAESKey = process.env.WECOM_KF_ENCODING_AES_KEY?.trim();
  if (!result.agentId) result.agentId = process.env.WECOM_KF_AGENT_ID?.trim();
  return result;
}
