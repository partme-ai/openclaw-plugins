/**
 * WeCom 配置模块导出
 */

export { WecomConfigSchema, type WecomConfigInput } from "./schema.js";
export {
    DEFAULT_ACCOUNT_ID,
    WECOM_KF_CHANNEL_ID,
    detectMode,
    listWecomAccountIds,
    listKfAccountIds,
    resolveDefaultWecomAccountId,
    resolveDefaultKfAccountId,
    resolveWecomAccount,
    resolveWecomAccountConflict,
    resolveWecomAccounts,
    resolveKfAccountByOpenKfId,
    createKfAccountConfigResolver,
    loadKfAgentMappingsFromConfig,
    isWecomEnabled,
    applyKfEnvVarFallback,
} from "./accounts.js";
export { resolveWecomEgressProxyUrl, resolveWecomEgressProxyUrlFromNetwork } from "./network.js";
export { DEFAULT_WECOM_MEDIA_MAX_BYTES, resolveWecomMediaMaxBytes } from "./media.js";
export { resolveWecomFailClosedOnDefaultRoute, shouldRejectWecomDefaultRoute } from "./routing.js";
export {
    DEFAULT_API_BASE_URL,
    DEFAULT_KF_WEBHOOK_PATH,
    collectWecomKfRoutePaths,
    isLegacyWecomCsEnabled,
    isIcsEnabled,
    normalizeRoutePath,
    resolveApiBaseUrl,
    resolveKfAccountWebhookPath,
} from "./kf-routes.js";
export {
    getWecomKfChannelBlock,
    LEGACY_WECOM_CS_CHANNEL_KEY,
    warnWecomCsChannelDeprecation,
} from "./channel-block.js";
