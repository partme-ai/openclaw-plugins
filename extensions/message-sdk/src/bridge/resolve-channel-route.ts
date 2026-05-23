/**
 * 统一封装 OpenClaw resolveAgentRoute，供 Wire 插件与 dispatchChannelMessage 使用。
 */

import type { BridgePluginRuntime } from "./types.js";

/** resolveAgentRoute 返回的路由信息子集。 */
export interface ChannelAgentRoute {
  agentId?: string;
  sessionKey?: string;
  mainSessionKey?: string;
  lastRoutePolicy?: string;
  accountId?: string;
}

/** resolveChannelAgentRoute 入参。 */
export interface ResolveChannelAgentRouteParams {
  channel: string;
  accountId: string;
  peerId: string;
  chatType?: "direct" | "group";
}

/**
 * 调用 OpenClaw 内置 resolveAgentRoute 解析 agentId / sessionKey。
 */
export async function resolveChannelAgentRoute(
  runtime: BridgePluginRuntime,
  params: ResolveChannelAgentRouteParams,
): Promise<ChannelAgentRoute> {
  const route = await runtime.channel.routing.resolveAgentRoute({
    cfg: runtime.config,
    channel: params.channel,
    accountId: params.accountId,
    peer: { kind: params.chatType ?? "direct", id: params.peerId },
  });
  return route as ChannelAgentRoute;
}

/**
 * 合并插件路由结果与 OpenClaw resolveAgentRoute，得到 dispatch 所需的 agentId / sessionKey。
 */
export async function resolveChannelDispatchIdentity(
  runtime: BridgePluginRuntime,
  params: ResolveChannelAgentRouteParams & {
    agentId?: string;
    sessionKey?: string;
  },
): Promise<{ agentId: string; sessionKey: string; route: ChannelAgentRoute }> {
  const route = await resolveChannelAgentRoute(runtime, params);
  const agentId =
    (params.agentId?.trim() || route.agentId?.trim() || "main");
  const sessionKey = (params.sessionKey?.trim() || route.sessionKey?.trim() || "").trim();
  if (!sessionKey) {
    throw new Error(
      `[message-sdk] resolveAgentRoute returned empty sessionKey for channel=${params.channel} peer=${params.peerId}`,
    );
  }
  return { agentId, sessionKey, route };
}
