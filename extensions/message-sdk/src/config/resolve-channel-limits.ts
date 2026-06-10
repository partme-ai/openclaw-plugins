/**
 * @module config/resolve-channel-limits
 *
 * 通道级 limits 解析 / Channel-level limit resolution (media, timeout, proxy).
 *
 * **职责**：从 OpenClaw 配置与环境变量解析媒体大小上限、Agent 回复超时、出口代理 URL，
 * 避免各通道插件重复实现优先级逻辑。
 *
 * **适用场景**：WeCom utils、媒体下载、HTTP 出站代理配置。
 *
 * **上下游**：
 * - 上游：OpenClaw `channels.*` / `agents.defaults` / 进程环境变量
 * - 下游：各通道插件 media / network 模块
 *
 * **关键导出**：`resolveChannelMediaMaxBytes`、`resolveChannelAgentReplyTimeoutMs`、
 * `resolveChannelEgressProxyUrl`、`ChannelLimitsOpenClawConfig`
 */

/** OpenClaw 配置子集（避免 SDK 强依赖完整 OpenClawConfig）/ Minimal config shape */
export type ChannelLimitsOpenClawConfig = {
  channels?: Record<
    string,
    | {
        media?: { maxBytes?: number };
        network?: { agentReplyTimeoutMs?: number; egressProxyUrl?: string };
      }
    | undefined
  >;
  agents?: { defaults?: { mediaMaxMb?: number } };
};

/**
 * 解析通道媒体最大字节数。
 *
 * **优先级**：
 * 1. `channels.{channelId}.media.maxBytes`
 * 2. `agents.defaults.mediaMaxMb`（转字节）
 * 3. `channelDefaultBytes`
 *
 * @param params.channelId - 通道 ID / Channel id
 * @param params.cfg - OpenClaw 配置子集 / Config subset
 * @param params.channelDefaultBytes - 通道插件默认值 / Plugin default bytes
 * @returns 有效媒体字节上限 / Max media bytes
 *
 * @example
 * ```ts
 * resolveChannelMediaMaxBytes({
 *   channelId: "wecom",
 *   cfg,
 *   channelDefaultBytes: 20 * 1024 * 1024,
 * });
 * ```
 */
export function resolveChannelMediaMaxBytes(params: {
  channelId: string;
  cfg: ChannelLimitsOpenClawConfig;
  channelDefaultBytes: number;
}): number {
  const val = params.cfg.channels?.[params.channelId]?.media?.maxBytes;
  if (typeof val === "number" && Number.isFinite(val) && val > 0) {
    return val;
  }
  const globalMb = params.cfg.agents?.defaults?.mediaMaxMb;
  if (typeof globalMb === "number" && Number.isFinite(globalMb) && globalMb > 0) {
    return globalMb * 1024 * 1024;
  }
  return params.channelDefaultBytes;
}

/**
 * 解析 Agent 回复总超时（毫秒）。
 *
 * **优先级**：
 * 1. `channels.{channelId}.network.agentReplyTimeoutMs`
 * 2. `defaultTimeoutMs`
 *
 * @param params.channelId - 通道 ID / Channel id
 * @param params.cfg - OpenClaw 配置子集 / Config subset
 * @param params.defaultTimeoutMs - 通道插件默认超时 / Plugin default ms
 * @returns 有效超时毫秒数 / Timeout in ms
 *
 * @example
 * ```ts
 * resolveChannelAgentReplyTimeoutMs({ channelId: "wecom", cfg, defaultTimeoutMs: 120_000 });
 * ```
 */
export function resolveChannelAgentReplyTimeoutMs(params: {
  channelId: string;
  cfg: ChannelLimitsOpenClawConfig;
  defaultTimeoutMs: number;
}): number {
  const val = params.cfg.channels?.[params.channelId]?.network?.agentReplyTimeoutMs;
  if (typeof val === "number" && Number.isFinite(val) && val > 0) {
    return val;
  }
  return params.defaultTimeoutMs;
}

/**
 * 解析出口代理 URL。
 *
 * **优先级**：
 * 1. `channels.{channelId}.network.egressProxyUrl`
 * 2. `envKeys` 依次查找（默认 HTTPS_PROXY / ALL_PROXY / HTTP_PROXY）
 *
 * @param params.channelId - 通道 ID / Channel id
 * @param params.cfg - OpenClaw 配置子集 / Config subset
 * @param params.envKeys - 环境变量键顺序，默认常见代理变量 / Env var keys to scan
 * @returns  trim 后的代理 URL，无则 `undefined`
 *
 * @example
 * ```ts
 * const proxy = resolveChannelEgressProxyUrl({ channelId: "wecom", cfg });
 * ```
 */
export function resolveChannelEgressProxyUrl(params: {
  channelId: string;
  cfg: ChannelLimitsOpenClawConfig;
  envKeys?: string[];
}): string | undefined {
  const channelProxy = params.cfg.channels?.[params.channelId]?.network?.egressProxyUrl;
  const envKeys = params.envKeys ?? ["HTTPS_PROXY", "ALL_PROXY", "HTTP_PROXY"];
  const proxyUrl =
    channelProxy ??
    envKeys.map((key) => process.env[key]).find((v) => v?.trim()) ??
    "";
  return proxyUrl.trim() || undefined;
}
