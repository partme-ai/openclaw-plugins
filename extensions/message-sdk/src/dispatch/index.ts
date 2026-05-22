/**
 * dispatch 模块 barrel export。
 */

export { createWireDispatch, type CreateWireDispatchOptions } from "./wire-dispatch.js";
export { createTranscriptDispatch } from "./transcript-dispatch.js";
export { createEmbeddedAgentDispatch } from "./embedded-dispatch.js";
export { createSubagentDispatch } from "./subagent-dispatch.js";
export { createChannelDispatch } from "./channel-dispatch.js";

export {
  extractFinalTextFromRunResult,
  extractSubagentResultText,
  sanitizeSessionId,
  createDispatchRunId,
} from "./agent-helpers.js";

export type {
  ChannelClass,
  ChannelDispatchMode,
  ChannelDispatchDeliverParams,
  ChannelDispatchReplyConfig,
  ChannelDispatchParams,
  ChannelDispatchResult,
  EmbeddedAgentRuntime,
  SubagentRuntime,
  EmbeddedAgentDispatchParams,
  SubagentDispatchParams,
  WireDispatchConfig,
  TranscriptDispatchConfig,
  DispatchConfig,
  WireDispatchParams,
  WireDispatchResult,
  TranscriptChannelRuntime,
  TranscriptDispatchParams,
  TranscriptRecordParams,
} from "./types.js";

export {
  CHANNEL_CLASS_WIRE,
  CHANNEL_CLASS_TRANSCRIPT,
  isWireChannelClass,
  isTranscriptChannelClass,
} from "../core/channel-class.js";
