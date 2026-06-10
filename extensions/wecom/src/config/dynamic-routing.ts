/**
 * @module dynamic-routing
 *
 * 动态 Agent 路由统一处理（委托 message-sdk routing）。
 *
 * **职责**：在 OpenClaw 默认 `resolveAgentRoute` 结果基础上，按
 * `channels.wecom.dynamicAgents` 配置为每个 peer（群/私聊）注入独立 agentId / sessionKey，
 * 实现 per-chat 会话隔离与多 Agent 并存。
 *
 * **适用场景**：`monitor.buildMessageContext` 在 finalizeInboundContext 之前调用。
 *
 * **上下游**：
 * - 上游：`dynamic-agent.getDynamicAgentConfig` / `generateAgentId`
 * - 下游：OpenClaw session store、dispatch 路由
 *
 * **关键导出**：`processDynamicRouting`
 */

import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import type { PluginRuntime } from "openclaw/plugin-sdk/core";
import {
  processDynamicPeerRouting,
  type AgentRouteLike,
  type DynamicPeerRoutingResult,
} from "@partme.ai/openclaw-message-sdk/routing";
import { generateAgentId, getDynamicAgentConfig } from "../channel/dynamic-agent.js";

/** WeCom Agent 路由（扩展 mainSessionKey） */
export interface AgentRoute extends AgentRouteLike {
  mainSessionKey?: string;
}

/** 动态路由处理入参 */
export interface DynamicRoutingParams {
  route: AgentRoute;
  config: OpenClawConfig;
  core: PluginRuntime;
  accountId: string;
  chatType: "group" | "dm";
  chatId: string;
  senderId: string;
  log?: (msg: string) => void;
  error?: (msg: string) => void;
}

export type { DynamicPeerRoutingResult as DynamicRoutingResult };

/**
 * 统一处理动态路由注入逻辑。
 *
 * **sessionKey 格式**：`agent:{agentId}:wecom:{accountId}:{chatType}:{peerId}`
 *
 * @param params.route - OpenClaw 默认路由（会被原地修改 agentId / sessionKey）
 * @param params.config - OpenClaw 全局配置
 * @param params.accountId - 企微账号 ID
 * @param params.chatType - `group` | `dm`
 * @param params.chatId - peer ID（群 chatid 或用户 userid）
 * @param params.senderId - 发送者 ID（allowlist 判定用）
 * @param params.log - 可选 info 日志
 * @returns 是否修改了 route 及最终 agentId / sessionKey
 */
export function processDynamicRouting(params: DynamicRoutingParams): DynamicPeerRoutingResult {
  const { route, config, accountId, chatType, chatId, senderId, log } = params;

  return processDynamicPeerRouting({
    route,
    chatType,
    peerId: chatId,
    accountId,
    senderId,
    dynamicConfig: getDynamicAgentConfig(config),
    buildAgentId: ({ chatType: type, peerId, accountId: acctId }) =>
      generateAgentId(type, peerId, acctId),
    buildSessionKey: ({ agentId, chatType: type, peerId, accountId: acctId }) =>
      `agent:${agentId}:wecom:${acctId}:${type}:${peerId}`,
    log,
  });
}
