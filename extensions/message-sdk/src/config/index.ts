/**
 * @module config/index
 *
 * config 模块 barrel export / Channel config merge and limits resolution.
 *
 * **关键导出**：`mergeChannelAccountConfig`、`resolveMergedChannelAccountConfig`、
 * `resolveChannelMediaMaxBytes`、`resolveChannelAgentReplyTimeoutMs`、
 * `resolveChannelEgressProxyUrl`
 */

export {
  mergeChannelAccountConfig,
  resolveMergedChannelAccountConfig,
} from "./merge-account-config.js";

export {
  resolveChannelMediaMaxBytes,
  resolveChannelAgentReplyTimeoutMs,
  resolveChannelEgressProxyUrl,
  type ChannelLimitsOpenClawConfig,
} from "./resolve-channel-limits.js";
