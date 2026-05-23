/**
 * @module ingress/group-policy
 *
 * 通道无关的群组访问控制。
 *
 * **职责**：三层校验——`groupPolicy`（open/allowlist/disabled）、群组 ID 白名单、
 * 单群 `groups.{chatId}.allowFrom` 发送者白名单。
 *
 * **适用场景**：群聊入站消息在 DM 策略之前或并行调用；`isSenderInAllowlist` 也被
 * `dm-policy` 复用于私聊白名单匹配。
 *
 * **上下游**：
 * - 上游：通道配置 `groupPolicy` / `groupAllowFrom` / `groups`
 * - 下游：`checkChannelGroupPolicy` 返回 allow/deny，插件据此丢弃或继续处理
 *
 * **关键导出**：`checkChannelGroupPolicy`、`resolveChannelGroupConfig`、`isSenderInAllowlist`
 */

/** 群组策略模式 */
export type GroupPolicyMode = "open" | "allowlist" | "disabled";

/** 单群配置 */
export interface ChannelGroupConfig {
  /** 群组内发送者白名单（空或未配置时视为不限制发送者） */
  allowFrom?: Array<string | number>;
}

/** 通道群组策略配置子集 */
export interface ChannelGroupPolicyConfig {
  /** 群组全局策略，默认 `open` */
  groupPolicy?: GroupPolicyMode;
  /** 群组 ID 白名单（groupPolicy=allowlist 时生效） */
  groupAllowFrom?: Array<string | number>;
  /** 按群 ID 的细粒度配置（支持 `*` 通配） */
  groups?: Record<string, ChannelGroupConfig>;
}

/** 群组策略检查结果 */
export interface GroupPolicyCheckResult {
  /** 是否允许处理该群消息 */
  allowed: boolean;
}

type RuntimeLog = {
  log?: (...args: unknown[]) => void;
};

/**
 * 解析指定群组的配置（支持 `*` 通配与大小写不敏感键）。
 *
 * 查找顺序：精确 match → 大小写不敏感 match → `*` 通配。
 *
 * @param params.groups - 群配置映射
 * @param params.groupId - 目标群 ID
 * @returns 匹配到的群配置，未匹配时 undefined
 */
export function resolveChannelGroupConfig(params: {
  groups?: Record<string, ChannelGroupConfig>;
  groupId?: string | null;
}): ChannelGroupConfig | undefined {
  const groups = params.groups ?? {};
  const wildcard = groups["*"];
  const groupId = params.groupId?.trim();
  if (!groupId) {
    return undefined;
  }

  const direct = groups[groupId];
  if (direct) {
    return direct;
  }

  // 大小写不敏感回退，兼容不同平台群 ID 大小写差异
  const lowered = groupId.toLowerCase();
  const matchKey = Object.keys(groups).find((key) => key.toLowerCase() === lowered);
  if (matchKey) {
    return groups[matchKey];
  }
  return wildcard;
}

/**
 * 检查发送者是否在允许列表中（通用 allowlist 匹配）。
 *
 * 支持 `"*"` 通配、渠道前缀剥离（如 `wecom:user123`）及 `user:` 前缀形式。
 *
 * @param senderId - 发送者 ID
 * @param allowFrom - 白名单条目数组
 * @param channelId - 渠道 ID（用于前缀剥离）
 * @returns 是否匹配
 */
export function isSenderInAllowlist(
  senderId: string,
  allowFrom: string[],
  channelId: string,
): boolean {
  if (allowFrom.includes("*")) {
    return true;
  }
  const prefix = new RegExp(`^${channelId}:`, "i");
  return allowFrom.some((entry) => {
    const normalized = entry.replace(prefix, "").trim();
    return normalized === senderId || normalized === `user:${senderId}`;
  });
}

/**
 * 群组 ID 层 allowlist 校验（groupPolicy + groupAllowFrom）。
 */
function isGroupInAllowlist(params: {
  groupPolicy: GroupPolicyMode;
  allowFrom: Array<string | number>;
  groupId: string;
  channelId: string;
}): boolean {
  const { groupPolicy, channelId } = params;
  if (groupPolicy === "disabled") {
    return false;
  }
  if (groupPolicy === "open") {
    return true;
  }
  const normalizedAllowFrom = params.allowFrom.map((entry) =>
    String(entry).replace(new RegExp(`^${channelId}:`, "i"), "").trim(),
  );
  if (normalizedAllowFrom.includes("*")) {
    return true;
  }
  const normalizedGroupId = params.groupId.trim();
  return normalizedAllowFrom.some(
    (entry) => entry === normalizedGroupId || entry.toLowerCase() === normalizedGroupId.toLowerCase(),
  );
}

/**
 * 单群发送者 allowlist 校验（groups.{chatId}.allowFrom）。
 *
 * 未配置 per-group allowFrom 时默认放行（仅受 groupPolicy 约束）。
 */
function isGroupSenderInAllowlist(params: {
  senderId: string;
  groupId: string;
  channelId: string;
  channelConfig: ChannelGroupPolicyConfig;
}): boolean {
  const groupConfig = resolveChannelGroupConfig({
    groups: params.channelConfig.groups,
    groupId: params.groupId,
  });

  const perGroupSenderAllowFrom = (groupConfig?.allowFrom ?? []).map((v) => String(v));

  if (perGroupSenderAllowFrom.length === 0) {
    return true;
  }

  if (perGroupSenderAllowFrom.includes("*")) {
    return true;
  }

  return isSenderInAllowlist(params.senderId, perGroupSenderAllowFrom, params.channelId);
}

/**
 * 检查群组策略访问控制（三层：groupPolicy → 群 ID → 群发送者）。
 *
 * @param params.channelId - 渠道 ID
 * @param params.chatId - 群聊 ID
 * @param params.senderId - 发送者 ID
 * @param params.channelConfig - 群组策略配置
 * @param params.runtime - 日志运行时
 * @param params.logPrefix - 日志前缀，默认 `[{channelId}]`
 * @returns 是否允许处理
 */
export function checkChannelGroupPolicy(params: {
  channelId: string;
  chatId: string;
  senderId: string;
  channelConfig: ChannelGroupPolicyConfig;
  runtime: RuntimeLog;
  logPrefix?: string;
}): GroupPolicyCheckResult {
  const { chatId, senderId, channelConfig, runtime, channelId } = params;
  const logPrefix = params.logPrefix ?? `[${channelId}]`;

  const groupPolicy = channelConfig.groupPolicy ?? "open";
  const groupAllowFrom = channelConfig.groupAllowFrom ?? [];
  const groupAllowed = isGroupInAllowlist({
    groupPolicy,
    allowFrom: groupAllowFrom,
    groupId: chatId,
    channelId,
  });

  if (!groupAllowed) {
    runtime.log?.(`${logPrefix} Group ${chatId} not allowed (groupPolicy=${groupPolicy})`);
    return { allowed: false };
  }

  const senderAllowed = isGroupSenderInAllowlist({
    senderId,
    groupId: chatId,
    channelId,
    channelConfig,
  });

  if (!senderAllowed) {
    runtime.log?.(`${logPrefix} Sender ${senderId} not in group ${chatId} sender allowlist`);
    return { allowed: false };
  }

  return { allowed: true };
}
