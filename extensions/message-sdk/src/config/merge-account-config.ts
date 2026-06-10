/**
 * @module config/merge-account-config
 *
 * 多账号通道配置深层合并 / Deep merge for multi-account channel config.
 *
 * **职责**：将 OpenClaw `channels.{id}` 顶层配置与 `accounts.{accountId}` 覆盖项合并；
 * 指定键（如 `groups`、`templates`）做 Record 浅层合并而非整体替换。
 *
 * **适用场景**：WeCom / Feishu 等多账号插件解析 `ResolvedAccount` 配置。
 *
 * **上下游**：
 * - 上游：OpenClaw 配置文件 `channels.*.accounts`
 * - 下游：各通道 `resolveAccountConfig` / ingress 策略链
 *
 * **关键导出**：`mergeChannelAccountConfig`、`resolveMergedChannelAccountConfig`
 */

/**
 * 合并顶层通道配置与账号级 overrides。
 *
 * 非 `deepMergeKeys` 字段：账号值 `!== undefined` 时直接覆盖顶层。
 * `deepMergeKeys` 字段：顶层与账号 Record 浅合并（账号键优先）。
 *
 * @param base - 顶层配置（不含 accounts / defaultAccount）/ Top-level channel block
 * @param accountOverrides - 账号级覆盖 / Per-account overrides
 * @param deepMergeKeys - 需要 Record 深层合并的键，默认 `groups`、`templates`
 * @returns 合并后的完整配置 / Merged config
 *
 * @example
 * ```ts
 * mergeChannelAccountConfig(base, accounts["bot-2"], ["groups", "templates"]);
 * ```
 */
export function mergeChannelAccountConfig<T extends Record<string, unknown>>(
  base: T,
  accountOverrides: Partial<T> | undefined,
  deepMergeKeys: Array<keyof T & string> = ["groups", "templates"],
): T {
  if (!accountOverrides) {
    return { ...base };
  }

  const deepSet = new Set<string>(deepMergeKeys);
  const result = { ...base } as T;

  // 普通字段：账号覆盖顶层
  for (const key of Object.keys(accountOverrides) as Array<keyof T & string>) {
    if (deepSet.has(key)) {
      continue;
    }
    if (accountOverrides[key] !== undefined) {
      (result as Record<string, unknown>)[key] = accountOverrides[key];
    }
  }

  // 深层合并字段：Record 浅合并
  for (const key of deepMergeKeys) {
    const baseVal = base[key];
    const accountVal = accountOverrides[key];
    if (baseVal || accountVal) {
      (result as Record<string, unknown>)[key] = {
        ...(typeof baseVal === "object" && baseVal !== null && !Array.isArray(baseVal)
          ? (baseVal as Record<string, unknown>)
          : {}),
        ...(typeof accountVal === "object" && accountVal !== null && !Array.isArray(accountVal)
          ? (accountVal as Record<string, unknown>)
          : {}),
      };
    }
  }

  return result;
}

/**
 * 从 OpenClaw 配置读取并合并指定 channel + accountId 的配置。
 *
 * @param params.cfg - OpenClaw 配置根对象 / Root config with `channels`
 * @param params.channelId - 通道 ID，如 `wecom`、`feishu` / Channel id
 * @param params.accountId - 账号 ID / Account id
 * @param params.findAccountConfig - 可选自定义账号查找（如 defaultAccount 回退）
 * @param params.deepMergeKeys - 深层合并键，默认 `groups`、`templates`
 * @returns 合并后的账号配置；通道不存在时返回 `{}`
 *
 * @example
 * ```ts
 * const cfg = resolveMergedChannelAccountConfig({
 *   cfg: openClawConfig,
 *   channelId: "wecom",
 *   accountId: "default",
 * });
 * ```
 */
export function resolveMergedChannelAccountConfig<T extends Record<string, unknown>>(params: {
  cfg: { channels?: Record<string, unknown> };
  channelId: string;
  accountId: string;
  findAccountConfig?: (
    accounts: Record<string, Partial<T>> | undefined,
    accountId: string,
  ) => Partial<T> | undefined;
  deepMergeKeys?: Array<keyof T & string>;
}): T {
  const channelBlock = params.cfg.channels?.[params.channelId] as
    | (T & { accounts?: Record<string, Partial<T>>; defaultAccount?: string })
    | undefined;

  if (!channelBlock) {
    return {} as T;
  }

  const { accounts, defaultAccount: _da, ...base } = channelBlock;
  const account =
    params.findAccountConfig?.(accounts, params.accountId) ??
    accounts?.[params.accountId] ??
    {};

  return mergeChannelAccountConfig(
    base as T,
    account as Partial<T>,
    params.deepMergeKeys ?? (["groups", "templates"] as Array<keyof T & string>),
  );
}
