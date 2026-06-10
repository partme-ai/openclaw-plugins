/**
 * @module dispatch
 *
 * dispatch 模块 barrel export。
 *
 * **职责**：对外暴露 Wire/Transcript/embedded/subagent 派发入口、通道类别常量与类型。
 *
 * **子模块**：`wire-dispatch`、`transcript-dispatch`、`channel-dispatch`、`embedded-dispatch`、
 * `subagent-dispatch`、`agent-helpers`、`types`
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

/** 重新导出 dispatch 层公共类型 / Re-export dispatch public types */
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
