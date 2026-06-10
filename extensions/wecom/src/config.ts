/**
 * WeCom 配置解析与账号列表（channels.wecom）。
 */

export {
  listWeComAccountIds,
  resolveWeComAccountMulti,
  resolveDefaultWeComAccountId,
  hasMultiAccounts,
  type WeComMultiAccountConfig,
} from "./config/accounts.js";

export type { WeComConfig, ResolvedWeComAccount } from "./config/wecom-config.js";
