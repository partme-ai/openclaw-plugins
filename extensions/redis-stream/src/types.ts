/**
 * @fileoverview openclaw-redis-stream 核心类型定义。
 *
 * @description
 * 配置、路由结果、会话上下文与入站消息形状的类型聚合，供 routing/transport/inbound 共享。
 *
 * @module types
 */

/** @description DM 会话粒度（与 OpenClaw session.dmScope 一致）。 */
export type DmScope =
  | "main"
  | "per-peer"
  | "per-channel-peer"
  | "per-account-channel-peer";

/** @description channel → agent 显式绑定规则。 */
export interface RedisChannelBinding {
  channelPattern: string;
  agentId: string;
  accountId?: string;
  replyChannel?: string;
}

/** @description 入站 channel 路由解析结果。 */
export interface RedisInboundRoute {
  agentId: string;
  accountId: string;
  replyChannel?: string;
  matchedPattern: string;
  source: "binding" | "standard" | "field";
}

/** @description 会话上下文（reply channel、最近入站 channel 等）。 */
export interface RedisSessionContext {
  peerId: string;
  agentId: string;
  accountId: string;
  lastInboundChannel?: string;
  replyChannel?: string;
  updatedAt: number;
}

/** @description Pub/Sub 或 Stream 消费回调传入的入站消息。 */
export interface RedisInboundMessage {
  channel: string;
  pattern?: string;
  message: string;
  /** Stream 模式：通过 fieldMapping 提取的字段，覆盖路由解析 */
  fieldAgentId?: string;
  fieldPeerId?: string;
  fieldAccountId?: string;
  fieldReplyStream?: string;
}

/** @description Redis Channel 完整运行时配置（与 `channels.redis-stream` 对齐）。 */
export type RedisChannelConfig = {
  url: string;
  channelMode: "pubsub" | "stream";
  /** 未匹配到任何路由时兜底使用的 Agent ID（空字符串 = 不兜底） */
  defaultAgentId: string;
  stream: {
    inboundKey: string;
    outboundKey: string;
    consumerGroup: string;
    consumerName: string;
    blockMs: number;
    count: number;
    createGroup: boolean;
  };
  subscribeChannels: string[];
  channelBindings: RedisChannelBinding[];
  payload: {
    mode: "plain" | "jsonTextOrPlain";
  };
  fieldMapping: {
    textField: string;
    agentIdField: string;
    peerIdField: string;
    accountIdField: string;
    replyStreamField: string;
  };
  connection: {
    reconnectMs: number;
    maxRetries: number;
  };
};
