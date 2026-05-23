/**
 * dispatch 模块 barrel export。
 */

export {
  dispatchWireMessage,
  type WireDispatchOptions,
} from "./wire-dispatch.js";
export { dispatchTranscriptTurn } from "./transcript-dispatch.js";
export { dispatchEmbeddedAgentMessage } from "./embedded-dispatch.js";
export { dispatchSubagentMessage } from "./subagent-dispatch.js";
export { dispatchChannelMessage } from "./channel-dispatch.js";

export {
  extractFinalTextFromRunResult,
  extractSubagentResultText,
  sanitizeSessionId,
  createDispatchRunId,
} from "./agent-helpers.js";

/**
 * 重新导出该模块的公共类型，方便调用方从 barrel 或实现文件按需导入。
 */
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
