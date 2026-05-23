/**
 * WeCom 通道配置类型与解析工具（utils）
 *
 * 定义顶层 `WeComConfig` / `ResolvedWeComAccount`（单账号向后兼容路径），
 * 以及媒体上限、Agent 超时、出口代理等运行时解析。
 *
 * 与 message-sdk 薄封装：
 * - `resolveWecomMediaMaxBytes` → SDK `resolveChannelMediaMaxBytes`
 * - `resolveWecomAgentReplyTimeoutMs` → SDK `resolveChannelAgentReplyTimeoutMs`
 * - `resolveWecomEgressProxyUrl` → SDK `resolveChannelEgressProxyUrl`
 *
 * 多账号场景请优先使用 `accounts.ts` 的 `resolveWeComAccountMulti`。
 */

import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import {
  resolveChannelMediaMaxBytes,
  resolveChannelAgentReplyTimeoutMs,
  resolveChannelEgressProxyUrl,
} from "@partme.ai/openclaw-message-sdk/config";
import { DEFAULT_ACCOUNT_ID } from "../shared/openclaw-compat.js";
import { CHANNEL_ID, DEFAULT_WECOM_MEDIA_MAX_BYTES, MESSAGE_PROCESS_TIMEOUT_MS } from "../types/const.js";
import type { ResolvedAgentAccount } from "../types/account.js";
import type { WeComUserTextConfig } from "./text-config.js";
import type {
  WecomAgentConfig,
  WecomNetworkConfig,
  WecomMediaConfig,
  WecomDynamicAgentsConfig,
  WecomFooterConfig,
  WecomStreamingNestedConfig,
} from "../types/config.js";

export type { WeComUserTextConfig } from "./text-config.js";

// ============================================================================
// 配置类型定义
// ============================================================================

/**
 * 企业微信群组配置
 */
export interface WeComGroupConfig {
  /** 群组内发送者白名单（仅列表中的成员消息会被处理） */
  allowFrom?: Array<string | number>;
}

/**
 * 企业微信配置类型
 */
export interface WeComConfig extends WeComUserTextConfig {
  enabled?: boolean;
  websocketUrl?: string;
  botId?: string;
  secret?: string;
  name?: string;
  allowFrom?: Array<string | number>;
  dmPolicy?: "open" | "allowlist" | "pairing" | "disabled";
  /** 群组访问策略："open" = 允许所有群组（默认），"allowlist" = 仅允许 groupAllowFrom 中的群组，"disabled" = 禁用群组消息 */
  groupPolicy?: "open" | "allowlist" | "disabled";
  /** 群组白名单（仅 groupPolicy="allowlist" 时生效） */
  groupAllowFrom?: Array<string | number>;
  /** 每个群组的详细配置（如群组内发送者白名单） */
  groups?: Record<string, WeComGroupConfig>;
  /** 是否发送"思考中"消息，默认为 true */
  sendThinkingMessage?: boolean;
  /**
   * 流式输出总开关：`false` = 默认模式（状态栏 + 最终整包）；`true` = 流式模式。
   * 也可为嵌套对象 `{ status?, content? }`（CLI dot-path 写入时）。
   */
  streaming?: boolean | WecomStreamingNestedConfig;
  /** 流式气泡脚注（状态栏 / 耗时） */
  footer?: WecomFooterConfig;
  /** 额外允许访问的本地媒体路径白名单（支持 ~ 表示 home 目录），如 ["~/Downloads", "~/Documents"] */
  mediaLocalRoots?: string[];
  /** Agent 模式配置（自建应用） */
  agent?: WecomAgentConfig;
  /** 网络配置 */
  network?: WecomNetworkConfig;
  /** 媒体处理配置 */
  media?: WecomMediaConfig;
  /** 动态 Agent 配置 */
  dynamicAgents?: WecomDynamicAgentsConfig;

  // ── Webhook 模式扩展字段 ──────────────────────────────────────────
  /** 连接模式：webhook | websocket（默认 websocket） */
  connectionMode?: "webhook" | "websocket";
  /** Webhook 验证 token */
  token?: string;
  /** AES 加密密钥（43 字符 Base64） */
  encodingAESKey?: string;
  /** 接收方 ID */
  receiveId?: string;
}

/**
 * 单个企业微信账号的配置类型（用于 accounts 字段下的每个账号）。
 * 与 WeComConfig 字段完全一致，账号级字段会覆盖顶层同名字段。
 */
export type WeComAccountConfig = Partial<WeComConfig>;

export const DefaultWsUrl = "wss://openws.work.weixin.qq.com";

/** 单账号解析结果：含 Bot WS 凭据与可选 Agent 能力 */
export interface ResolvedWeComAccount {
  accountId: string;
  name: string;
  enabled: boolean;
  websocketUrl: string;
  botId: string;
  secret: string;
  /** 是否发送"思考中"消息，默认为 true */
  sendThinkingMessage: boolean;
  config: WeComConfig;
  /** Agent 模式能力（自建应用） */
  agent?: ResolvedAgentAccount;
  /** Webhook 模式配置 */
  token?: string;
  encodingAESKey?: string;
  receiveId?: string,
}

/**
 * 解析企业微信账户配置（单账号 / 无 accounts 字段时的兼容入口）。
 *
 * @param cfg OpenClaw 全局配置
 * @returns 默认 accountId 下的 Bot 配置快照（不含 Agent 解析，见 accounts 模块）
 */
export function resolveWeComAccount(cfg: OpenClawConfig): ResolvedWeComAccount {
  const wecomConfig = (cfg.channels?.[CHANNEL_ID] ?? {}) as WeComConfig;

  return {
    accountId: DEFAULT_ACCOUNT_ID,
    name: wecomConfig.name ?? "企业微信",
    enabled: wecomConfig.enabled !== false,
    websocketUrl: wecomConfig.websocketUrl || DefaultWsUrl,
    botId: wecomConfig.botId ?? "",
    secret: wecomConfig.secret ?? "",
    sendThinkingMessage: wecomConfig.sendThinkingMessage ?? true,
    config: wecomConfig,
  };
}

/**
 * 写入单账号模式下的 channels.wecom 配置（onboarding 旧路径）。
 *
 * @param cfg 当前配置
 * @param account 要合并的部分字段
 */
export function setWeComAccount(
  cfg: OpenClawConfig,
  account: Partial<WeComConfig>,
): OpenClawConfig {
  const existing = (cfg.channels?.[CHANNEL_ID] ?? {}) as WeComConfig;
  const merged: WeComConfig = {
    enabled: account.enabled ?? existing?.enabled ?? true,
    botId: account.botId ?? existing?.botId ?? "",
    secret: account.secret ?? existing?.secret ?? "",
    allowFrom: account.allowFrom ?? existing?.allowFrom,
    dmPolicy: account.dmPolicy ?? existing?.dmPolicy,
    // 以下字段仅在已有配置值或显式传入时才写入，onboarding 时不主动生成
    ...(account.websocketUrl || existing?.websocketUrl
      ? { websocketUrl: account.websocketUrl ?? existing?.websocketUrl }
      : {}),
    ...(account.name || existing?.name
      ? { name: account.name ?? existing?.name }
      : {}),
    ...(account.sendThinkingMessage !== undefined || existing?.sendThinkingMessage !== undefined
      ? { sendThinkingMessage: account.sendThinkingMessage ?? existing?.sendThinkingMessage }
      : {}),
  };

return {
    ...cfg,
    channels: {
      ...cfg.channels,
      [CHANNEL_ID]: merged,
    },
  };
}

/**
 * 解析 WeCom 通道媒体最大字节数（委托 message-sdk，默认 20MB）。
 *
 * @param cfg OpenClaw 全局配置（读取 channels.wecom.media.maxBytes 等）
 */
export function resolveWecomMediaMaxBytes(cfg: OpenClawConfig): number {
  return resolveChannelMediaMaxBytes({
    channelId: CHANNEL_ID,
    cfg,
    channelDefaultBytes: DEFAULT_WECOM_MEDIA_MAX_BYTES,
  });
}

/**
 * 解析 Agent 回复总超时（委托 message-sdk，默认 MESSAGE_PROCESS_TIMEOUT_MS）。
 *
 * @param cfg OpenClaw 全局配置（channels.wecom.network.agentReplyTimeoutMs）
 */
export function resolveWecomAgentReplyTimeoutMs(cfg: OpenClawConfig): number {
  return resolveChannelAgentReplyTimeoutMs({
    channelId: CHANNEL_ID,
    cfg,
    defaultTimeoutMs: MESSAGE_PROCESS_TIMEOUT_MS,
  });
}

/**
 * 解析出口 HTTP 代理 URL（委托 message-sdk，支持 env 与 network.egressProxyUrl）。
 *
 * @param cfg OpenClaw 全局配置
 */
export function resolveWecomEgressProxyUrl(cfg: OpenClawConfig): string | undefined {
  return resolveChannelEgressProxyUrl({
    channelId: CHANNEL_ID,
    cfg,
    envKeys: [
      "OPENCLAW_WECOM_EGRESS_PROXY_URL",
      "WECOM_EGRESS_PROXY_URL",
      "HTTPS_PROXY",
      "ALL_PROXY",
      "HTTP_PROXY",
    ],
  });
}
