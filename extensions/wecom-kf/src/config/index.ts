/**
 * 企微客服配置模块导出
 * 与 wecom 插件 config/index 结构对齐
 */

export {
  getEventMessagesConfig,
  getDefaultEventMessages,
} from "./event-messages.js";

export {
  initializeKfAccounts,
  loadCustomAgentMappings,
  setCustomAgentMapping,
  getCustomAgentMappings,
  registerAccountMapping,
  getAccountMapping,
  cacheServicers,
  getCachedServicers,
  getOnlineServicers,
  getAllKfAccountIds,
} from "./accounts.js";

/**
 * 列出配置中的客服账号 ID
 * 对应 channel.config.listAccountIds
 *
 * @param cfg - 全局配置
 * @returns 账号 ID 列表（来自 channels.wecom-kf.accounts 的 key）
 */
export function listKfAccountIds(cfg: Record<string, unknown>): string[] {
  const channels = cfg.channels as Record<string, Record<string, unknown>> | undefined;
  const wecomKf = channels?.["wecom-kf"];
  const accounts = wecomKf?.accounts as Record<string, unknown> | undefined;
  return Object.keys(accounts ?? {});
}

/**
 * 解析指定账号的配置
 * 对应 channel.config.resolveAccount
 *
 * @param cfg - 全局配置
 * @param accountId - 账号 ID，缺省为 "default"
 * @returns 账号配置，不存在时返回空对象
 */
export function resolveKfAccount(
  cfg: Record<string, unknown>,
  accountId?: string
): import("../types/index.js").WecomAccountConfig {
  const channels = cfg.channels as Record<string, Record<string, unknown>> | undefined;
  const wecomKf = channels?.["wecom-kf"];
  const accounts = wecomKf?.accounts as Record<string, import("../types/index.js").WecomAccountConfig> | undefined;
  return accounts?.[accountId ?? "default"] ?? ({} as import("../types/index.js").WecomAccountConfig);
}
