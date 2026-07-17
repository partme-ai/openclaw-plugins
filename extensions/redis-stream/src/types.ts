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
  /** Stream 模式 entry ID（用于 XACK / 幂等） */
  streamEntryId?: string;
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
    /** XAUTOCLAIM 最小 idle 毫秒；0 表示禁用 pending 回收 */
    pendingClaimIdleMs: number;
    /** Maximum delivery count before atomically moving an entry to deadLetterKey. */
    maxAttempts: number;
    /** Dead-letter stream key. */
    deadLetterKey: string;
    /** Approximate MAXLEN applied to plugin-owned output and DLQ streams; 0 disables trimming. */
    maxLen: number;
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
    /** 远程主机是否允许使用明文 redis://；本机回环不受限制。 */
    allowInsecureRemote: boolean;
    reconnectMs: number;
    /** 指数退避最大等待时间。 */
    reconnectMaxMs: number;
    /** 双向抖动比例（0~1），降低多 Gateway 实例同时重连。 */
    reconnectJitterRatio: number;
    /** 0 means unlimited reconnects after the first successful connection. */
    maxRetries: number;
    /** Pub/Sub 模式允许同时进入 Agent 管道的最大消息数；达到上限时拒绝新消息。 */
    maxPubSubInFlight: number;
    startupTimeoutMs: number;
    /** Gateway 停止时等待 Redis 客户端优雅退出的最长时间。 */
    shutdownTimeoutMs: number;
  };
  idempotency: {
    enabled: boolean;
    ttlMs: number;
    maxEntries: number;
  };
};
