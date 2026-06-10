/**
 * @module web-socket/routing/agent-router
 *
 * 入站连接 / 帧内 agentId → Agent 路由。
 */

import type { WebsocketAgentBinding, WebsocketChannelConfig, WebsocketInboundRoute } from "../types.js";

const DEFAULT_ACCOUNT_ID = "default";

/**
 * 按绑定、帧内 agentId、defaultAgentId 解析入站路由。
 *
 * @param connectionId - WebSocket 连接 id
 * @param config - 渠道配置
 * @param frameAgentId - 客户端帧可选 agentId
 */
export function resolveInboundRoute(
  connectionId: string,
  config: WebsocketChannelConfig,
  frameAgentId?: string,
): WebsocketInboundRoute | null {
  for (const binding of config.agentBindings) {
    if (binding.connectionId && binding.connectionId === connectionId) {
      return {
        agentId: binding.agentId,
        accountId: binding.accountId ?? DEFAULT_ACCOUNT_ID,
        source: "binding",
      };
    }
    if (
      binding.connectionIdPrefix &&
      connectionId.startsWith(binding.connectionIdPrefix)
    ) {
      return {
        agentId: binding.agentId,
        accountId: binding.accountId ?? DEFAULT_ACCOUNT_ID,
        source: "binding",
      };
    }
  }

  if (frameAgentId) {
    return {
      agentId: frameAgentId,
      accountId: DEFAULT_ACCOUNT_ID,
      source: "frame",
    };
  }

  if (config.defaultAgentId) {
    return {
      agentId: config.defaultAgentId,
      accountId: DEFAULT_ACCOUNT_ID,
      source: "default",
    };
  }

  return null;
}
