/**
 * openclaw-rockermq 核心类型定义。
 */

// ─────────────── RocketMQ 配置类型 ───────────────

/** 入站 payload 解析模式 */
export type RockermqPayloadParseMode = "jsonTextOrPlain" | "jsonOnly" | "plainText";

/**
 * RocketMQ Payload 解析配置
 */
export interface RockermqPayloadConfig {
  mode: RockermqPayloadParseMode;
}

/**
 * Topic 与 Agent 的显式绑定配置
 */
export interface RockermqTopicBinding {
  topic: string;
  tag: string;
  agentId: string;
  accountId: string;
  replyTopic?: string;
  replyTag?: string;
}

/**
 * RocketMQ 通用消息格式
 */
export interface RockermqMessage {
  agentId: string;
  peerId: string;
  content: string;
  timestamp: string;
}

/**
 * 会话上下文
 */
export interface RockermqSessionContext {
  peerId: string;
  agentId: string;
  accountId: string;
  lastInboundTopic?: string;
  lastInboundTag?: string;
  replyTopic?: string;
  replyTag?: string;
  updatedAt: number;
}

/**
 * Topic 到 Agent 的路由结果
 */
export interface RockermqInboundRoute {
  agentId: string;
  accountId: string;
  peerId: string;
  replyTopic?: string;
  replyTag?: string;
  source: "binding" | "standard";
  matchedTopic?: string;
}

// ─────────────── DM Scope ───────────────

/** 全局 DM 会话粒度 */
export type DmScope = "main" | "per-peer" | "per-channel-peer" | "per-account-channel-peer";
