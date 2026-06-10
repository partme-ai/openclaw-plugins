/**
 * @module bridge/types
 *
 * OpenClaw 桥接层类型（与 plugin-sdk channel.reply 对齐）。
 *
 * **职责**：定义 BridgePluginRuntime 能力子集及入站/出站桥接参数，避免通道插件直接耦合宿主完整 Runtime。
 *
 * **关键导出**：`BridgePluginRuntime`、`InboundBridgeParams`、`ReplyBridgeParams`
 */

import type { ReplyRoute, UnifiedMessage } from "../core/types.js";

/**
 * 插件 Runtime 中 channel 子集 / Bridge plugin runtime channel subset.
 *
 * 仅包含 routing、reply 派发所需的最小 API。
 */
export interface BridgePluginRuntime {
  /** OpenClaw 配置对象 / OpenClaw config */
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

/** 入站桥接参数 / Inbound bridge parameters */
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

/** 出站桥接参数 / Reply bridge parameters */
export interface ReplyBridgeParams {
  runtime: BridgePluginRuntime;
  channel: string;
  accountId: string;
  peerId: string;
  sessionKey?: string;
  /** 出站发布回调（传输层实现）/ Transport-layer publish callback */
  deliver: (payload: { text: string; wire: string }) => void | Promise<void>;
  outboundFormat?: "envelope" | "legacyJsonText" | "plainText";
  replyRoute?: ReplyRoute;
  agentId?: string;
}

/** createReplyHandler 返回值 / Reply handler creation result */
export interface ReplyBridgeResult {
  dispatcher: unknown;
  replyOptions: Record<string, unknown>;
}
