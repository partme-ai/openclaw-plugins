/**
 * openclaw-redis-stream 类型定义。
 */

/** DM session scope（与 OpenClaw session.dmScope 一致） */
export type DmScope = "main" | "per-peer" | "per-channel-peer" | "per-account-channel-peer";

/** channel → agent 绑定配置 */
export interface RedisChannelBinding {
  channelPattern: string;
  agentId: string;
  accountId?: string;
  replyChannel?: string;
}

/** topic 路由结果 */
export interface RedisInboundRoute {
  agentId: string;
  accountId: string;
  replyChannel?: string;
  matchedPattern: string;
  source: "binding" | "standard" | "field";
}

/** 会话上下文 */
export interface RedisSessionContext {
  peerId: string;
  agentId: string;
  accountId: string;
  lastInboundChannel?: string;
  replyChannel?: string;
  updatedAt: number;
}

/** 入站消息 */
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

/** 完整配置类型 */
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
