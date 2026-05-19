/**
 * 客服账号自动发现与缓存
 * 使用 kf/account/list（94661）、kf/servicer/list（94645）建立 open_kfid → Agent 映射
 * 与 wecom 插件 config/accounts 职责对齐
 */

import type {
  KfAccount,
  AccountMapping,
  ServicerInfo,
  WecomAccountConfig,
} from "../types/index.js";
import {
  listKfAccounts,
  listServicers,
  getAccessToken,
} from "../agent/api-client.js";

/** 账号映射缓存：open_kfid → AccountMapping */
const accountMappings = new Map<string, AccountMapping>();

/** 接待人员缓存：open_kfid → ServicerInfo[] */
const servicerCache = new Map<string, ServicerInfo[]>();

/** 自定义 Agent 映射表：open_kfid → agentId */
const customAgentMapping = new Map<string, string>();

/**
 * 初始化客服账号
 * 插件 onReady 时调用，自动发现并注册所有客服账号
 *
 * @param config - 渠道配置（channels.wecom-kf）
 */
export async function initializeKfAccounts(
  config: Record<string, unknown>
): Promise<void> {
  const accounts = config.accounts as
    | Record<string, WecomAccountConfig>
    | undefined;

  if (!accounts) {
    console.warn("[wecom_kf] No accounts configured in channels.wecom-kf.accounts");
    return;
  }

  for (const [accountId, accountCfg] of Object.entries(accounts)) {
    try {
      const accessToken = await getAccessToken(
        accountCfg.corpId,
        accountCfg.corpSecret
      );

      const kfAccounts = await listKfAccounts(accessToken);

      for (const kfAccount of kfAccounts) {
        if (!kfAccount.manage_privilege) {
          console.warn(
            `[wecom_kf] 账号 ${kfAccount.name} (${kfAccount.open_kfid}) 无管理权限，跳过`
          );
          continue;
        }

        const agentId = resolveAgentId(kfAccount.open_kfid, accountId);
        registerAccountMapping(kfAccount.open_kfid, {
          name: kfAccount.name,
          avatar: kfAccount.avatar,
          agentId,
        });

        const servicers = await listServicers(accessToken, kfAccount.open_kfid);
        cacheServicers(kfAccount.open_kfid, servicers);

        console.log(
          `[wecom_kf] 注册账号: ${kfAccount.name} (${kfAccount.open_kfid}), ` +
            `Agent: ${agentId}, 在线坐席: ${servicers.filter((s) => s.status === 0).length}`
        );
      }
    } catch (error) {
      console.error(
        `[wecom_kf] 初始化账号 ${accountId} 失败:`,
        error
      );
    }
  }
}

/**
 * 根据 open_kfid 解析对应的 Agent ID
 * 优先级：customAgentMapping > accountId
 */
function resolveAgentId(openKfId: string, accountId: string): string {
  const customAgent = customAgentMapping.get(openKfId);
  if (customAgent) return customAgent;
  return accountId === "default" ? "default" : accountId;
}

/**
 * 从配置中加载自定义 Agent 映射
 *
 * @param config - 渠道配置（channels.wecom-kf）
 */
export function loadCustomAgentMappings(
  config: Record<string, unknown>
): void {
  const accounts = config.accounts as
    | Record<string, WecomAccountConfig & { agentMapping?: Record<string, string>; agentId?: string }>
    | undefined;

  if (!accounts) return;

  customAgentMapping.clear();

  for (const [accountId, accountCfg] of Object.entries(accounts)) {
    if (accountCfg.agentMapping) {
      for (const [kfId, agentId] of Object.entries(accountCfg.agentMapping)) {
        customAgentMapping.set(kfId, agentId);
        console.log(`[wecom_kf] Custom agent mapping: ${kfId} → ${agentId}`);
      }
    }

    if (accountCfg.agentId && accountCfg.openKfId) {
      if (!customAgentMapping.has(accountCfg.openKfId)) {
        customAgentMapping.set(accountCfg.openKfId, accountCfg.agentId);
        console.log(
          `[wecom_kf] Account-level agent mapping: ${accountCfg.openKfId} → ${accountCfg.agentId}`
        );
      }
    }
  }

  console.log(
    `[wecom_kf] Loaded ${customAgentMapping.size} custom agent mapping(s)`
  );
}

/**
 * 手动设置单个自定义 Agent 映射
 */
export function setCustomAgentMapping(
  openKfId: string,
  agentId: string
): void {
  customAgentMapping.set(openKfId, agentId);
}

/**
 * 获取所有自定义 Agent 映射（用于调试/管理接口）
 */
export function getCustomAgentMappings(): Record<string, string> {
  return Object.fromEntries(customAgentMapping);
}

/**
 * 注册账号映射
 */
export function registerAccountMapping(
  openKfId: string,
  mapping: AccountMapping
): void {
  accountMappings.set(openKfId, mapping);
}

/**
 * 获取账号映射
 */
export function getAccountMapping(
  openKfId: string
): AccountMapping | undefined {
  return accountMappings.get(openKfId);
}

/**
 * 缓存接待人员列表
 */
export function cacheServicers(
  openKfId: string,
  servicers: ServicerInfo[]
): void {
  servicerCache.set(openKfId, servicers);
}

/**
 * 获取缓存的接待人员列表
 */
export function getCachedServicers(
  openKfId: string
): ServicerInfo[] | undefined {
  return servicerCache.get(openKfId);
}

/**
 * 获取在线接待人员
 * servicer/list 中 status=0 表示接待中
 */
export function getOnlineServicers(
  openKfId: string
): ServicerInfo[] {
  const servicers = servicerCache.get(openKfId) ?? [];
  return servicers.filter((s) => s.status === 0);
}

/**
 * 获取所有已注册的账号 ID（运行时缓存键）
 */
export function getAllKfAccountIds(): string[] {
  return Array.from(accountMappings.keys());
}
