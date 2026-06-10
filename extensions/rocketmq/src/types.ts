/**
 * @fileoverview RocketMQ 插件的类型聚合再导出（仅类型，零运行时）。
 *
 * @description
 * 集中暴露 RocketMQ 渠道相关的配置、消息、路由与会话类型符号，
 * 避免消费方从 config / routing 多个深层路径串联 import。
 *
 * @module types
 */

/**
 * RocketMQ 共享类型 — Base Profile 入口。
 */

// ─────────────── RocketMQ 配置类型 ───────────────

/** @description 入站 payload 解析模式（与 config.PayloadMode 对齐）。 */
export type RockermqPayloadParseMode = "jsonTextOrPlain" | "jsonOnly" | "plainText";

/**
 * @description RocketMQ Payload 解析配置。
 */
export interface RockermqPayloadConfig {
  mode: RockermqPayloadParseMode;
}

/**
 * @description Topic 与 Agent 的显式绑定配置（与 config.TopicBinding 字段一致）。
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
 * @description RocketMQ 通用消息 JSON 形状（legacy / 文档用途）。
 */
export interface RockermqMessage {
  agentId: string;
  peerId: string;
  content: string;
  timestamp: string;
}

/**
 * @description 会话级路由上下文（replyTopic / replyTag / 最近入站 Topic）。
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
 * @description Topic/Tag 解析后的入站路由结果（binding 或 standard 命名规范）。
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

/** @description 全局 DM 会话粒度（与 OpenClaw routing 对齐）。 */
export type DmScope = "main" | "per-peer" | "per-channel-peer" | "per-account-channel-peer";
