/**
 * dispatch 层配置与参数类型（Wire / Transcript 双路径）。
 */

import type { ChannelClass } from "../core/channel-class.js";
import type { UnifiedMessage } from "../core/types.js";
import type { DispatchInboundParams, DispatchInboundResult } from "../bridge/inbound-bridge.js";
import type { BridgePluginRuntime } from "../bridge/types.js";
import type { OutboundWireFormat } from "../pipeline/serialize-payload.js";

export type { ChannelClass };

/** Wire MQ 插件 dispatch 模式。 */
export type ChannelDispatchMode = "reply-pipeline" | "embedded-agent" | "subagent";

/** createChannelDispatch deliver 回调参数。 */
export interface ChannelDispatchDeliverParams {
  wire: string;
  text?: string;
  runId?: string;
}

/** embedded / subagent / wire 共用的 reply 配置。 */
export interface ChannelDispatchReplyConfig {
  deliver: (payload: ChannelDispatchDeliverParams) => void | Promise<void>;
  outboundFormat?: OutboundWireFormat;
  replyRoute?: Record<string, string>;
  agentId?: string;
  sessionKey?: string;
  /** embedded/subagent 序列化 userId 字段（默认 sessionKey）。 */
  userId?: string;
}

/** createChannelDispatch 入参。 */
export interface ChannelDispatchParams {
  mode?: ChannelDispatchMode;
  runtime: BridgePluginRuntime;
  channel: string;
  accountId: string;
  peerId: string;
  text: string;
  agentId?: string;
  sessionKey?: string;
  unified?: UnifiedMessage | null;
  chatType?: "direct" | "group";
  extra?: Record<string, unknown>;
  sessionId?: string;
  childSessionKey?: string;
  timeoutMs?: number;
  replyEnabled?: boolean;
  reply: ChannelDispatchReplyConfig;
}

/** createChannelDispatch 返回值。 */
export type ChannelDispatchResult =
  | { mode: "reply-pipeline"; wireResult: DispatchInboundResult }
  | { mode: "embedded-agent"; runId: string; delivered: boolean }
  | { mode: "subagent"; runId: string; delivered: boolean };

/** embedded-agent runtime 能力子集。 */
export interface EmbeddedAgentRuntime extends BridgePluginRuntime {
  agent: {
    resolveAgentDir: (cfg: Record<string, unknown>, agentId: string) => Promise<string>;
    resolveAgentWorkspaceDir: (cfg: Record<string, unknown>, agentId: string) => string;
    runEmbeddedAgent: (params: {
      sessionId: string;
      sessionKey: string;
      agentId: string;
      sessionFile: string;
      workspaceDir: string;
      prompt: string;
      timeoutMs: number;
      runId: string;
      config: Record<string, unknown>;
    }) => Promise<unknown>;
  };
}

/** subagent runtime 能力子集。 */
export interface SubagentRuntime extends BridgePluginRuntime {
  subagent: {
    run: (params: {
      sessionKey: string;
      message: string;
      deliver: boolean;
    }) => Promise<{ runId: string }>;
    waitForRun: (params: { runId: string; timeoutMs: number }) => Promise<unknown>;
  };
}

/** createEmbeddedAgentDispatch 入参。 */
export interface EmbeddedAgentDispatchParams {
  runtime: EmbeddedAgentRuntime;
  channel: string;
  accountId: string;
  peerId: string;
  text: string;
  agentId: string;
  sessionKey: string;
  sessionId?: string;
  timeoutMs?: number;
  runId?: string;
  reply: ChannelDispatchReplyConfig;
}

/** createSubagentDispatch 入参。 */
export interface SubagentDispatchParams {
  runtime: SubagentRuntime;
  channel: string;
  accountId: string;
  peerId: string;
  text: string;
  agentId: string;
  sessionKey: string;
  childSessionKey?: string;
  timeoutMs?: number;
  replyEnabled?: boolean;
  reply: ChannelDispatchReplyConfig;
}

/** Wire 路径 dispatch 配置（MQ 插件）。 */
export interface WireDispatchConfig {
  channelClass: "wire";
}

/** Transcript 路径 dispatch 配置（IM 插件）。 */
export interface TranscriptDispatchConfig {
  channelClass: "transcript";
}

export type DispatchConfig = WireDispatchConfig | TranscriptDispatchConfig;

/** createWireDispatch 入参，与 bridge.dispatchInbound 对齐。 */
export type WireDispatchParams = DispatchInboundParams;

/** createWireDispatch 返回值，与 bridge.dispatchInbound 对齐。 */
export type WireDispatchResult = DispatchInboundResult;

/** Transcript 路径 recordInboundSession 参数子集。 */
export interface TranscriptRecordParams {
  storePath: string;
  sessionKey: string;
  ctx: Record<string, unknown>;
  updateLastRoute?: {
    sessionKey: string;
    channel: string;
    to: string;
    accountId: string;
  };
  onRecordError?: (err: unknown) => void;
}

/** OpenClaw channel.turn.runAssembled 所需 runtime 子集。 */
export interface TranscriptChannelRuntime {
  turn?: {
    runAssembled?: (params: {
      cfg: Record<string, unknown>;
      channel: string;
      accountId: string;
      agentId: string;
      routeSessionKey: string;
      storePath: string;
      ctxPayload: Record<string, unknown>;
      recordInboundSession: (
        params: TranscriptRecordParams,
      ) => void | Promise<void>;
      dispatchReplyWithBufferedBlockDispatcher: (params: {
        ctx: Record<string, unknown>;
        cfg: Record<string, unknown>;
        dispatcherOptions: {
          deliver: (payload: { text: string }) => void | Promise<void>;
          onError?: (error: unknown) => void;
        };
      }) => void | Promise<void>;
      delivery: {
        deliver: (payload: { text: string }) => void | Promise<void>;
        onError?: (error: unknown) => void;
      };
      record?: {
        updateLastRoute?: TranscriptRecordParams["updateLastRoute"];
        onRecordError?: (err: unknown) => void;
      };
    }) => void | Promise<void>;
  };
  session?: {
    resolveStorePath?: (
      store?: string,
      opts?: { agentId?: string },
    ) => string | undefined;
    recordInboundSession?: (params: TranscriptRecordParams) => void | Promise<void>;
  };
  reply: {
    dispatchReplyWithBufferedBlockDispatcher: (params: {
      ctx: Record<string, unknown>;
      cfg: Record<string, unknown>;
      dispatcherOptions: {
        deliver: (payload: { text: string }) => void | Promise<void>;
        onError?: (error: unknown) => void;
      };
    }) => void | Promise<void>;
  };
}

/** createTranscriptDispatch 入参。 */
export interface TranscriptDispatchParams {
  channelRuntime: TranscriptChannelRuntime;
  cfg: Record<string, unknown>;
  channel: string;
  accountId: string;
  agentId: string;
  sessionKey: string;
  storePath?: string;
  inboundContext: Record<string, unknown>;
  record: {
    updateLastRoute?: TranscriptRecordParams["updateLastRoute"];
    onRecordError?: (err: unknown) => void;
  };
  delivery: {
    deliver: (payload: { text: string }) => void | Promise<void>;
    onError?: (error: unknown) => void;
  };
}
