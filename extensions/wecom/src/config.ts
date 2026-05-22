/**
 * WeCom 配置解析与账号列表（channels.wecom）。
 */

export {
  listWeComAccountIds,
  resolveWeComAccountMulti,
  resolveDefaultWeComAccountId,
  hasMultiAccounts,
  type WeComMultiAccountConfig,
} from "./accounts.js";

export type { WeComConfig, ResolvedWeComAccount } from "./utils.js";
