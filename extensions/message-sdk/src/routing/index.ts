/**
 * @module routing/index
 *
 * routing 模块 barrel export / Session peer cache and dynamic agent routing.
 *
 * **关键导出**：`createSessionPeerCache`、`processDynamicPeerRouting`、
 * `shouldUseDynamicPeerAgent`、`readDynamicAgentsFromChannelConfig` 及相关类型。
 */

export {
  sanitizeDynamicIdPart,
  shouldUseDynamicPeerAgent,
  processDynamicPeerRouting,
  readDynamicAgentsFromChannelConfig,
  type DynamicPeerAgentConfig,
  type AgentRouteLike,
  type DynamicPeerRoutingParams,
  type DynamicPeerRoutingResult,
} from "./dynamic-peer-agent.js";

export {
  createSessionPeerCache,
  type SessionPeerCache,
  type SessionPeerInfo,
} from "./session-peer-cache.js";
