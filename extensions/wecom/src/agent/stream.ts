/**
 * Stream Mode - Agent Mode Capability
 *
 * Implements streaming responses with 6-minute window
 * Handles stream placeholder responses and refresh callbacks
 *
 * Source: wecom-app stream mode implementation
 */

import type { ResolvedAgentAccount } from "../types/index.js";
import { sendText } from "./api-client.js";

/**
 * Stream state for tracking active streaming responses
 */
export type StreamState = {
  streamId: string;
  msgid?: string;
  createdAt: number;
  updatedAt: number;
  started: boolean;
  finished: boolean;
  error?: string;
  content: string;
};

/**
 * Stream configuration
 */
const STREAM_TTL_MS = 10 * 60 * 1000; // 10 minute TTL
const STREAM_MAX_BYTES = 512_000; // 500KB max content size
const INITIAL_STREAM_WAIT_MS = 5000; // 5 second initial wait

/**
 * Stream state storage (in-memory)
 */
const streams = new Map<string, StreamState>();
const msgidToStreamId = new Map<string, string>();

/**
 * Clean up expired streams
 */
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
 * Generate unique stream ID
 * @returns Random stream ID
 */
export function createStreamId(): string {
  // Simple random ID generation
  return Math.random().toString(36).substring(2, 18) + Date.now().toString(36);
}

/**
 * Create new stream state
 * @returns New stream state
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
 * Get stream state by ID
 * @param streamId - Stream ID
 * @returns Stream state or undefined
 */
export function getStream(streamId: string): StreamState | undefined {
  return streams.get(streamId);
}

/**
 * Update stream content
 * @param streamId - Stream ID
 * @param update - Update function or partial state
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
 * Build stream placeholder response
 * @param streamId - Stream ID
 * @returns Stream message object
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
 * Build stream response from state
 * @param state - Stream state
 * @returns Stream message object
 */
export function buildStreamResponse(state: StreamState): {
  msgtype: "stream";
  stream: { id: string; finish: boolean; content: string };
} {
  // Truncate content to max bytes
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
 * Truncate UTF-8 string to max bytes
 * @param text - Input text
 * @param maxBytes - Maximum byte length
 * @returns Truncated text
 */
function truncateUtf8Bytes(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= maxBytes) return text;
  const slice = buf.subarray(buf.length - maxBytes);
  return slice.toString("utf8");
}

/**
 * Wait for stream content with timeout
 * @param streamId - Stream ID
 * @param maxWaitMs - Maximum wait time in milliseconds
 * @returns Promise that resolves when content is available or timeout
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
 * Send stream refresh to WeCom
 * @param account - Agent account
 * @param userId - User ID to send refresh to
 * @param streamId - Stream ID
 * @param content - Updated content
 * @param finished - Whether stream is finished
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

  // Update state
  state.content = content;
  state.finished = finished;
  state.updatedAt = Date.now();

  // Build stream response
  const response = buildStreamResponse(state);

  // Send as text message (WeCom doesn't support native stream type in Agent mode)
  // In production, this would be sent via the framework's stream mechanism
  await sendText({
    agent: account,
    toUser: userId,
    text: content,
  });
}

/**
 * Clean up expired streams (should be called periodically)
 */
export function cleanupExpiredStreams(): void {
  pruneStreams();
}

/**
 * Check if stream has expired
 * @param state - Stream state
 * @param windowMs - Time window in milliseconds (default 6 minutes)
 * @returns true if stream has expired
 */
export function isStreamExpired(state: StreamState, windowMs: number = 6 * 60 * 1000): boolean {
  return Date.now() - state.createdAt > windowMs;
}

/**
 * Get time remaining in stream window
 * @param state - Stream state
 * @param windowMs - Time window in milliseconds (default 6 minutes)
 * @returns Remaining milliseconds
 */
export function getStreamTimeRemaining(state: StreamState, windowMs: number = 6 * 60 * 1000): number {
  const elapsed = Date.now() - state.createdAt;
  return Math.max(0, windowMs - elapsed);
}
