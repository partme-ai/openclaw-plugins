/**
 * OpenClaw 桥接层类型（与 plugin-sdk channel.reply 对齐）。
 */

import type { ReplyRoute, UnifiedMessage } from "../core/types.js";

/** 插件 Runtime 中 channel 子集，用于 bridge 层避免直接耦合宿主完整 Runtime。 */
export interface BridgePluginRuntime {
  config: Record<string, unknown>;
  channel: {
    routing: {
      resolveAgentRoute: (params: {
        cfg: Record<string, unknown>;
        channel: string;
        accountId: string;
        peer: { kind: "direct" | "group"; id: string };
      }) => Promise<Record<string, unknown>>;
    };
    reply: {
      finalizeInboundContext: (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
      createReplyDispatcherWithTyping: (params: {
        deliver: (payload: { text: string; mediaUrl?: string }) => void | Promise<void>;
      }) => unknown;
      dispatchReplyFromConfig: (params: {
        ctx: Record<string, unknown>;
        cfg: Record<string, unknown>;
        dispatcher: unknown;
        replyOptions: Record<string, unknown>;
      }) => Promise<void>;
    };
  };
}

/**
 * InboundBridgeParams 描述 bridge 模块公开 API 的结构化参数或返回值。
 *
 * 字段命名保持贴近业务语义，便于通道插件在不复制 SDK 实现的情况下组合能力。
 */
export interface InboundBridgeParams {
  runtime: BridgePluginRuntime;
  channel: string;
  accountId: string;
  peerId: string;
  text: string;
  chatType?: "direct" | "group";
  agentId?: string;
  unified?: UnifiedMessage | null;
  extra?: Record<string, unknown>;
}

/**
 * ReplyBridgeParams 描述 bridge 模块公开 API 的结构化参数或返回值。
 *
 * 字段命名保持贴近业务语义，便于通道插件在不复制 SDK 实现的情况下组合能力。
 */
export interface ReplyBridgeParams {
  runtime: BridgePluginRuntime;
  channel: string;
  accountId: string;
  peerId: string;
  sessionKey?: string;
  /** 出站发布回调（传输层实现）。 */
  deliver: (payload: { text: string; wire: string }) => void | Promise<void>;
  outboundFormat?: "envelope" | "legacyJsonText" | "plainText";
  replyRoute?: ReplyRoute;
  agentId?: string;
}

/**
 * ReplyBridgeResult 描述 bridge 模块公开 API 的结构化参数或返回值。
 *
 * 字段命名保持贴近业务语义，便于通道插件在不复制 SDK 实现的情况下组合能力。
 */
export interface ReplyBridgeResult {
  dispatcher: unknown;
  replyOptions: Record<string, unknown>;
}
