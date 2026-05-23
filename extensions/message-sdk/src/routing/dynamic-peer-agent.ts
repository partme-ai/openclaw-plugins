/**
 * @module routing/dynamic-peer-agent
 *
 * 动态 per-peer Agent 路由 / Dynamic per-peer agent routing injection.
 *
 * **职责**：当 OpenClaw 路由 `matchedBy=default` 时，按配置为 DM/群聊 peer 注入隔离的
 * `agentId` 与 `sessionKey`，实现多用户/多群独立 Agent 上下文。
 *
 * **适用场景**：WeCom / Feishu 等启用 `dynamicAgents` 的通道插件。
 *
 * **上下游**：
 * - 上游：OpenClaw Agent 路由结果、`channels.*.dynamicAgents` 配置
 * - 下游：dispatch / transcript 使用 `finalAgentId`、`finalSessionKey`
 *
 * **关键导出**：`processDynamicPeerRouting`、`shouldUseDynamicPeerAgent`、
 * `sanitizeDynamicIdPart`、`readDynamicAgentsFromChannelConfig`
 */

/** 动态 Agent 配置 / Dynamic routing feature flags */
export type DynamicPeerAgentConfig = {
  /** 总开关 / Master enable */
  enabled: boolean;
  /** 私聊是否为每个 peer 创建独立 Agent / Per-DM agent */
  dmCreateAgent: boolean;
  /** 群聊是否启用动态 Agent / Per-group agent */
  groupEnabled: boolean;
  /** 管理员用户 ID 列表（跳过动态路由）/ Admin senders excluded from dynamic routing */
  adminUsers: string[];
};

/** OpenClaw 路由结果子集 / Minimal route shape from OpenClaw */
export type AgentRouteLike = {
  agentId: string;
  sessionKey: string;
  matchedBy: string;
  accountId: string;
  mainSessionKey?: string;
};

/** 动态路由处理入参 / Input to {@link processDynamicPeerRouting} */
export type DynamicPeerRoutingParams = {
  route: AgentRouteLike;
  chatType: "group" | "dm";
  peerId: string;
  accountId: string;
  senderId: string;
  dynamicConfig: DynamicPeerAgentConfig;
  buildAgentId: (ctx: {
    chatType: "group" | "dm";
    peerId: string;
    accountId: string;
  }) => string;
  buildSessionKey: (ctx: {
    agentId: string;
    chatType: "group" | "dm";
    peerId: string;
    accountId: string;
  }) => string;
  log?: (msg: string) => void;
};

/** 动态路由处理结果 / Output of {@link processDynamicPeerRouting} */
export type DynamicPeerRoutingResult = {
  /** 是否启用动态 Agent / Whether dynamic agent was applied */
  useDynamicAgent: boolean;
  /** 最终 agentId（可能为注入值）/ Final agent id */
  finalAgentId: string;
  /** 最终 sessionKey（可能为注入值）/ Final session key */
  finalSessionKey: string;
  /** 相对原 route 是否发生修改 / Whether route differed from input */
  routeModified: boolean;
};

/**
 * 规范化动态路由 ID 片段（小写、仅保留 a-z0-9_-）。
 *
 * 用于构建 agentId / sessionKey 中的 peer 段，避免非法字符。
 *
 * @param value - 原始 ID 片段 / Raw id segment
 * @returns 规范化后的片段 / Sanitized segment
 *
 * @example
 * ```ts
 * sanitizeDynamicIdPart("Room@123"); // => "room_123"
 * ```
 */
export function sanitizeDynamicIdPart(value: string): string {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_");
}

/**
 * 判断是否应对当前 peer 启用动态 Agent。
 *
 * 关闭条件：`enabled=false`、发送者为 admin、或 DM/群对应子开关关闭。
 *
 * @param params.chatType - 会话类型 / `group` or `dm`
 * @param params.senderId - 发送者 ID / Sender id
 * @param params.dynamicConfig - 动态路由配置 / Dynamic config
 * @returns 是否启用动态 Agent / Whether to use dynamic agent
 *
 * @example
 * ```ts
 * shouldUseDynamicPeerAgent({ chatType: "dm", senderId, dynamicConfig });
 * ```
 */
export function shouldUseDynamicPeerAgent(params: {
  chatType: "group" | "dm";
  senderId: string;
  dynamicConfig: DynamicPeerAgentConfig;
}): boolean {
  const { chatType, senderId, dynamicConfig } = params;

  if (!dynamicConfig.enabled) {
    return false;
  }

  const sender = String(senderId).trim().toLowerCase();
  const isAdmin = dynamicConfig.adminUsers.some(
    (admin) => admin.trim().toLowerCase() === sender,
  );
  if (isAdmin) {
    return false;
  }

  if (chatType === "group") {
    return dynamicConfig.groupEnabled;
  }
  return dynamicConfig.dmCreateAgent;
}

/**
 * 处理动态路由注入；不修改传入的 route 对象。
 *
 * 仅当 `route.matchedBy === "default"` 且 {@link shouldUseDynamicPeerAgent} 为 true
 * 时，通过 `buildAgentId` / `buildSessionKey` 生成目标路由。
 *
 * @param params - 路由上下文与构建回调 / Routing context and builders
 * @returns 最终 agentId、sessionKey 及是否修改标志 / Resolved routing result
 *
 * @example
 * ```ts
 * const result = processDynamicPeerRouting({
 *   route,
 *   chatType: "dm",
 *   peerId,
 *   accountId,
 *   senderId,
 *   dynamicConfig,
 *   buildAgentId: (ctx) => `wecom-dm-${ctx.peerId}`,
 *   buildSessionKey: (ctx) => `agent:${ctx.agentId}:dm:${ctx.peerId}`,
 * });
 * ```
 */
export function processDynamicPeerRouting(
  params: DynamicPeerRoutingParams,
): DynamicPeerRoutingResult {
  const { route, chatType, peerId, accountId, senderId, dynamicConfig, buildAgentId, buildSessionKey, log } =
    params;

  log?.(`[dynamic-routing] matchedBy=${route.matchedBy}, agentId=${route.agentId}`);

  // 非 default 匹配：尊重 OpenClaw 显式路由规则
  if (route.matchedBy !== "default") {
    log?.(`[dynamic-routing] skip: matchedBy=${route.matchedBy}`);
    return {
      useDynamicAgent: false,
      finalAgentId: route.agentId,
      finalSessionKey: route.sessionKey,
      routeModified: false,
    };
  }

  const useDynamicAgent = shouldUseDynamicPeerAgent({
    chatType,
    senderId,
    dynamicConfig,
  });

  if (!useDynamicAgent) {
    return {
      useDynamicAgent: false,
      finalAgentId: route.agentId,
      finalSessionKey: route.sessionKey,
      routeModified: false,
    };
  }

  const targetAgentId = buildAgentId({ chatType, peerId, accountId });
  const targetSessionKey = buildSessionKey({
    agentId: targetAgentId,
    chatType,
    peerId,
    accountId,
  });

  log?.(`[dynamic-routing] inject agentId=${targetAgentId}`);

  return {
    useDynamicAgent: true,
    finalAgentId: targetAgentId,
    finalSessionKey: targetSessionKey,
    routeModified: true,
  };
}

/**
 * 从 OpenClaw `channels.{channelId}.dynamicAgents` 读取配置。
 *
 * 缺失字段回退到 `defaults`（默认 enabled=false，DM/群子开关 true，admin 空列表）。
 *
 * @param config - 含 `channels` 的配置对象 / Config with channels block
 * @param channelId - 通道 ID / Channel id
 * @param defaults - 默认值 / Default config when fields absent
 * @returns 完整动态 Agent 配置 / Resolved dynamic config
 *
 * @example
 * ```ts
 * const dynamic = readDynamicAgentsFromChannelConfig(openClawConfig, "wecom");
 * ```
 */
export function readDynamicAgentsFromChannelConfig(
  config: { channels?: Record<string, { dynamicAgents?: Partial<DynamicPeerAgentConfig> }> },
  channelId: string,
  defaults: DynamicPeerAgentConfig = {
    enabled: false,
    dmCreateAgent: true,
    groupEnabled: true,
    adminUsers: [],
  },
): DynamicPeerAgentConfig {
  const dynamicAgents = config.channels?.[channelId]?.dynamicAgents;
  return {
    enabled: dynamicAgents?.enabled ?? defaults.enabled,
    dmCreateAgent: dynamicAgents?.dmCreateAgent ?? defaults.dmCreateAgent,
    groupEnabled: dynamicAgents?.groupEnabled ?? defaults.groupEnabled,
    adminUsers: dynamicAgents?.adminUsers ?? defaults.adminUsers,
  };
}
