/**
 * @module dynamic-agent
 *
 * 动态 Agent 路由：配置读取与 Agent ID 生成（通用逻辑见 message-sdk routing）。
 *
 * **职责**：
 * - 从 `channels.wecom.dynamicAgents` 读取启用开关与白名单
 * - 按 peer 生成稳定 agentId：`wecom-{accountId}-{chatType}-{sanitizedPeerId}`
 * - 判定当前消息是否应走动态 Agent
 *
 * **适用场景**：`dynamic-routing.processDynamicRouting`、配置探测。
 *
 * **上下游**：
 * - 上游：openclaw.json `channels.wecom.dynamicAgents`
 * - 下游：`dynamic-routing`、OpenClaw multi-agent session 隔离
 *
 * **关键导出**：`getDynamicAgentConfig`、`generateAgentId`、`shouldUseDynamicAgent`
 */

import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import {
  readDynamicAgentsFromChannelConfig,
  sanitizeDynamicIdPart,
  shouldUseDynamicPeerAgent,
  type DynamicPeerAgentConfig,
} from "@partme.ai/openclaw-message-sdk/routing";
import { CHANNEL_ID } from "../types/const.js";

/** WeCom 动态 Agent 配置（与 message-sdk DynamicPeerAgentConfig 一致） */
export interface DynamicAgentConfig extends DynamicPeerAgentConfig {}

/**
 * 读取 `channels.wecom.dynamicAgents` 配置并合并默认值。
 *
 * @param config - OpenClaw 全局配置
 * @returns 动态 Agent 配置（enabled / allowFrom 等）
 */
export function getDynamicAgentConfig(config: OpenClawConfig): DynamicAgentConfig {
  return readDynamicAgentsFromChannelConfig(
    config as { channels?: Record<string, { dynamicAgents?: Partial<DynamicAgentConfig> }> },
    CHANNEL_ID,
  );
}

export { sanitizeDynamicIdPart };

/**
 * 生成动态 Agent ID。
 *
 * **格式**：`wecom-{accountId}-{chatType}-{sanitizedPeerId}`
 *
 * peerId / accountId 经 {@link sanitizeDynamicIdPart} 清洗（仅保留安全字符）。
 *
 * @param chatType - `dm` | `group`
 * @param peerId - 群 chatid 或用户 userid
 * @param accountId - 企微账号 ID，默认 `default`
 * @returns 稳定 agentId 字符串
 */
export function generateAgentId(
  chatType: "dm" | "group",
  peerId: string,
  accountId?: string,
): string {
  const sanitizedPeer = sanitizeDynamicIdPart(peerId) || "unknown";
  const sanitizedAccountId = sanitizeDynamicIdPart(accountId ?? "default") || "default";
  return `wecom-${sanitizedAccountId}-${chatType}-${sanitizedPeer}`;
}

/**
 * 检查当前消息是否应使用动态 Agent（enabled + allowFrom 判定）。
 *
 * @param params.chatType - `dm` | `group`
 * @param params.senderId - 发送者 ID
 * @param params.config - OpenClaw 全局配置
 * @returns 是否启用动态 Agent 路由
 */
export function shouldUseDynamicAgent(params: {
  chatType: "dm" | "group";
  senderId: string;
  config: OpenClawConfig;
}): boolean {
  return shouldUseDynamicPeerAgent({
    chatType: params.chatType,
    senderId: params.senderId,
    dynamicConfig: getDynamicAgentConfig(params.config),
  });
}
