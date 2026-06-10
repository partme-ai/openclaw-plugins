/**
 * @module agent/stream
 *
 * Agent 模式 **流式回复** 内存状态管理（占位/刷新窗口）。
 *
 * **职责**：
 * - 维护 streamId → 内容/完成态 的内存 Map（TTL 10 分钟）
 * - 构建企微 stream 占位与增量响应结构
 * - Agent 模式下实际投递仍走 `sendText` API（非原生 stream 被动回复）
 *
 * **说明**：源自 wecom-app stream 实现；6 分钟窗口用于判断 stream 是否过期。
 */

import { truncateUtf8Bytes } from "@partme.ai/openclaw-message-sdk/util";
import type { ResolvedAgentAccount } from "../types/index.js";
import { sendText } from "./api-client.js";

/** 单次 Agent 回复的 stream 内存状态 */
export type StreamState = {
  /** 唯一 stream 标识 */
  streamId: string;
  /** 关联的企微 msgid（可选） */
  msgid?: string;
  /** 创建时间戳（ms） */
  createdAt: number;
  /** 最后更新时间戳（ms） */
  updatedAt: number;
  /** 是否已开始写入内容 */
  started: boolean;
  /** 是否已结束 */
  finished: boolean;
  /** 错误信息（如有） */
  error?: string;
  /** 累积文本内容 */
  content: string;
};

/** stream 条目 TTL：10 分钟 */
const STREAM_TTL_MS = 10 * 60 * 1000;
/** 单 stream 最大 UTF-8 字节数 */
const STREAM_MAX_BYTES = 512_000;
/** 首次等待内容的最大毫秒数 */
const INITIAL_STREAM_WAIT_MS = 5000;

/** streamId → 状态 */
const streams = new Map<string, StreamState>();
/** msgid → streamId 反向索引 */
const msgidToStreamId = new Map<string, string>();

/** 清理超过 TTL 的 stream 及孤立 msgid 映射 */
function pruneStreams(): void {
  const cutoff = Date.now() - STREAM_TTL_MS;
  for (const [id, state] of streams.entries()) {
    if (state.updatedAt < cutoff) {
      streams.delete(id);
    }
  }
  for (const [msgid, id] of msgidToStreamId.entries()) {
    if (!streams.has(id)) {
      msgidToStreamId.delete(msgid);
    }
  }
}

/**
 * 生成唯一 streamId。
 */
export function createStreamId(): string {
  return Math.random().toString(36).substring(2, 18) + Date.now().toString(36);
}

/**
 * 创建并注册新的 stream 状态。
 */
export function createStream(): StreamState {
  const streamId = createStreamId();
  const state: StreamState = {
    streamId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    started: false,
    finished: false,
    content: "",
  };
  streams.set(streamId, state);
  return state;
}

/**
 * 按 streamId 获取状态。
 *
 * @param streamId - stream 标识
 */
export function getStream(streamId: string): StreamState | undefined {
  return streams.get(streamId);
}

/**
 * 更新 stream 状态（部分字段或 updater 函数）。
 *
 * @param streamId - stream 标识
 * @param update - 部分字段或 `(state) => void`
 */
export function updateStream(
  streamId: string,
  update: Partial<StreamState> | ((state: StreamState) => void)
): void {
  const state = streams.get(streamId);
  if (!state) return;

  if (typeof update === "function") {
    update(state);
  } else {
    Object.assign(state, update);
  }
  state.updatedAt = Date.now();
}

/**
 * 构建初始 stream 占位消息（finish=false）。
 *
 * @param streamId - stream 标识
 */
export function buildStreamPlaceholder(streamId: string): {
  msgtype: "stream";
  stream: { id: string; finish: boolean; content: string };
} {
  return {
    msgtype: "stream",
    stream: {
      id: streamId,
      finish: false,
      content: "稍等~",
    },
  };
}

/**
 * 根据当前状态构建 stream 响应（截断至 STREAM_MAX_BYTES）。
 *
 * @param state - stream 状态
 */
export function buildStreamResponse(state: StreamState): {
  msgtype: "stream";
  stream: { id: string; finish: boolean; content: string };
} {
  const content = truncateUtf8Bytes(state.content, STREAM_MAX_BYTES);
  return {
    msgtype: "stream",
    stream: {
      id: state.streamId,
      finish: state.finished,
      content,
    },
  };
}

/**
 * 轮询等待 stream 出现内容、完成或错误（默认 5s 超时）。
 *
 * @param streamId - stream 标识
 * @param maxWaitMs - 最大等待毫秒
 */
export async function waitForStreamContent(
  streamId: string,
  maxWaitMs: number = INITIAL_STREAM_WAIT_MS
): Promise<void> {
  if (maxWaitMs <= 0) return;
  const startedAt = Date.now();
  await new Promise<void>((resolve) => {
    const tick = () => {
      const state = streams.get(streamId);
      if (!state) return resolve();
      if (state.error || state.finished || state.content.trim()) return resolve();
      if (Date.now() - startedAt >= maxWaitMs) return resolve();
      setTimeout(tick, 25);
    };
    tick();
  });
}

/**
 * 向用户发送 stream 刷新（Agent 模式降级为 sendText）。
 *
 * @param account - Agent 账号
 * @param userId - 接收用户 userid
 * @param streamId - stream 标识
 * @param content - 更新后的文本
 * @param finished - 是否标记为已完成
 */
export async function sendStreamRefresh(
  account: ResolvedAgentAccount,
  userId: string,
  streamId: string,
  content: string,
  finished: boolean = false
): Promise<void> {
  const state = streams.get(streamId);
  if (!state) {
    throw new Error(`Stream ${streamId} not found`);
  }

  state.content = content;
  state.finished = finished;
  state.updatedAt = Date.now();

  buildStreamResponse(state);

  await sendText({
    agent: account,
    toUser: userId,
    text: content,
  });
}

/** 主动清理过期 stream（可周期性调用） */
export function cleanupExpiredStreams(): void {
  pruneStreams();
}

/**
 * 判断 stream 是否超出企微刷新窗口（默认 6 分钟）。
 *
 * @param state - stream 状态
 * @param windowMs - 窗口毫秒数
 */
export function isStreamExpired(state: StreamState, windowMs: number = 6 * 60 * 1000): boolean {
  return Date.now() - state.createdAt > windowMs;
}

/**
 * 返回 stream 窗口内剩余毫秒数。
 *
 * @param state - stream 状态
 * @param windowMs - 窗口毫秒数
 */
export function getStreamTimeRemaining(state: StreamState, windowMs: number = 6 * 60 * 1000): number {
  const elapsed = Date.now() - state.createdAt;
  return Math.max(0, windowMs - elapsed);
}
