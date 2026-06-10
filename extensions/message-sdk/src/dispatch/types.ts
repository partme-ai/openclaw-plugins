/**
 * @module dispatch/types
 *
 * dispatch 层配置与参数类型（Wire / Transcript 双路径）。
 *
 * **职责**：定义 dispatchChannelMessage、dispatchWireMessage、dispatchTranscriptTurn、
 * embedded/subagent dispatch 的入参、返回值与 Runtime 能力子集类型。
 *
 * **关键导出**：`ChannelDispatchParams`、`TranscriptDispatchParams`、`WireDispatchConfig`
 */

import type { ChannelClass } from "../core/channel-class.js";
import type { UnifiedMessage } from "../core/types.js";
import type { DispatchInboundParams, DispatchInboundResult } from "../bridge/inbound-bridge.js";
import type { BridgePluginRuntime } from "../bridge/types.js";
import type { OutboundWireFormat } from "../pipeline/serialize-payload.js";

/** 重新导出通道类别 / Re-export channel class type */
export type { ChannelClass };

/**
 * Wire 通道 dispatch 运行模式 / Channel dispatch mode for wire plugins.
 *
 * - `reply-pipeline`：OpenClaw dispatchInbound + reply pipeline
 * - `embedded-agent`：进程内 runEmbeddedAgent
 * - `subagent`：子 Agent run + waitForRun
 */
export type ChannelDispatchMode = "reply-pipeline" | "embedded-agent" | "subagent";

/** dispatchChannelMessage deliver 回调参数 / Deliver callback payload */
export interface ChannelDispatchDeliverParams {
  /** 序列化后的 wire 字符串 / Serialized wire payload */
  wire: string;
  /** 原始回复文本 / Plain reply text */
  text?: string;
  /** Agent run ID / Run id */
  runId?: string;
}

/** embedded / subagent / wire 共用的 reply 配置 / Shared reply config for dispatch modes */
export interface ChannelDispatchReplyConfig {
  /** 出站 deliver 回调 / Outbound deliver callback */
  deliver: (payload: ChannelDispatchDeliverParams) => void | Promise<void>;
  /** 出站 wire 格式 / Outbound wire format */
  outboundFormat?: OutboundWireFormat;
  /** 回复路由（MQ topic 等）/ Reply route for publish */
  replyRoute?: Record<string, string>;
  /** Agent ID / Agent id */
  agentId?: string;
  /** Session key / Session key */
  sessionKey?: string;
  /** embedded/subagent 序列化 userId 字段（默认 sessionKey）/ userId for envelope */
  userId?: string;
}

/** dispatchChannelMessage 入参 / Params for unified channel dispatch */
export interface ChannelDispatchParams {
  /** 运行模式，默认 reply-pipeline / Dispatch mode */
  mode?: ChannelDispatchMode;
  /** OpenClaw bridge runtime / Bridge runtime */
  runtime: BridgePluginRuntime;
  /** 渠道 ID / Channel id */
  channel: string;
  /** 账号 ID / Account id */
  accountId: string;
  /** Peer ID / Peer id */
  peerId: string;
  /** 入站文本 / Inbound text */
  text: string;
  /** 可选 agent ID（可被 resolveAgentRoute 覆盖）/ Optional agent id */
  agentId?: string;
  /** 可选 session key / Optional session key */
  sessionKey?: string;
  /** 可选 UnifiedMessage / Optional unified message */
  unified?: UnifiedMessage | null;
  /** 会话类型 / Chat type */
  chatType?: "direct" | "group";
  /** 扩展字段（messageId 等）/ Extra metadata */
  extra?: Record<string, unknown>;
  /** embedded 模式 sessionId / Embedded session id */
  sessionId?: string;
  /** subagent 子 session key / Child session key for subagent */
  childSessionKey?: string;
  /** 超时毫秒 / Timeout in ms */
  timeoutMs?: number;
  /** subagent 是否等待并 deliver 回复 / Whether subagent delivers reply */
  replyEnabled?: boolean;
  /** 回复配置 / Reply delivery config */
  reply: ChannelDispatchReplyConfig;
}

/** dispatchChannelMessage 返回值 / Result discriminated by mode */
export type ChannelDispatchResult =
  | { mode: "reply-pipeline"; wireResult: DispatchInboundResult }
  | { mode: "embedded-agent"; runId: string; delivered: boolean }
  | { mode: "subagent"; runId: string; delivered: boolean };

/** embedded-agent runtime 能力子集 / Embedded agent runtime capability subset */
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

/** subagent runtime 能力子集 / Subagent runtime capability subset */
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

/** dispatchEmbeddedAgentMessage 入参 / Embedded agent dispatch params */
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

/** dispatchSubagentMessage 入参 / Subagent dispatch params */
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

/** Wire 路径 dispatch 配置（MQ 插件）/ Wire dispatch config */
export interface WireDispatchConfig {
  channelClass: "wire";
}

/** Transcript 路径 dispatch 配置（IM 插件）/ Transcript dispatch config */
export interface TranscriptDispatchConfig {
  channelClass: "transcript";
}

/** Wire 与 Transcript 配置联合 / Dispatch config union */
export type DispatchConfig = WireDispatchConfig | TranscriptDispatchConfig;

/** dispatchWireMessage 入参，与 bridge.dispatchInbound 对齐 / Wire dispatch params alias */
export type WireDispatchParams = DispatchInboundParams;

/** dispatchWireMessage 返回值 / Wire dispatch result alias */
export type WireDispatchResult = DispatchInboundResult;

/** Transcript 路径 recordInboundSession 参数子集 / Transcript record params subset */
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

/** OpenClaw channel.turn.runAssembled 所需 runtime 子集 / Transcript channel runtime subset */
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

/** dispatchTranscriptTurn 入参 / Transcript turn dispatch params */
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
