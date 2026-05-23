/**
 * @module dispatch/channel-dispatch
 *
 * Wire 通道统一 dispatch 路由：按 mode 选择 reply-pipeline / embedded-agent / subagent。
 *
 * **职责**：MQ/机器通道的统一入口；解析 agentId/sessionKey 后按 mode 分流，
 * 避免 RabbitMQ、MQTT、Redis Stream 等插件重复维护派发逻辑。
 *
 * **关键导出**：`dispatchChannelMessage`
 */

import { resolveChannelDispatchIdentity } from "../bridge/resolve-channel-route.js";
import type { BridgePluginRuntime } from "../bridge/types.js";
import { dispatchWireMessage, type WireDispatchOptions } from "./wire-dispatch.js";
import { dispatchEmbeddedAgentMessage } from "./embedded-dispatch.js";
import { dispatchSubagentMessage } from "./subagent-dispatch.js";
import type {
  ChannelDispatchMode,
  ChannelDispatchParams,
  ChannelDispatchResult,
  EmbeddedAgentRuntime,
  SubagentRuntime,
} from "./types.js";

/**
 * 按 dispatch.mode 将入站消息路由到对应 SDK 实现 / Route inbound message by dispatch mode.
 *
 * - `reply-pipeline`：OpenClaw dispatchInbound + reply pipeline
 * - `embedded-agent`：进程内 runEmbeddedAgent → serialize → deliver
 * - `subagent`：子 Agent run → waitForRun → deliver
 *
 * sessionKey / agentId 未提供时经 OpenClaw resolveAgentRoute 解析。
 *
 * @param params - 通道、账号、peer、文本、mode、Runtime、reply 配置
 * @param wireOptions - 仅 reply-pipeline 使用的 Wire 队列选项
 * @returns 按 mode 区分的派发结果
 */
export async function dispatchChannelMessage(
  params: ChannelDispatchParams,
  wireOptions?: WireDispatchOptions,
): Promise<ChannelDispatchResult> {
  const mode: ChannelDispatchMode = params.mode ?? "reply-pipeline";
  const runtime = params.runtime as BridgePluginRuntime;

  const { agentId, sessionKey } = await resolveChannelDispatchIdentity(runtime, {
    channel: params.channel,
    accountId: params.accountId,
    peerId: params.peerId,
    chatType: params.chatType,
    agentId: params.agentId,
    sessionKey: params.sessionKey,
  });

  // Embedded/subagent 需要更强 Runtime；普通 MQ 插件仍可传入最小 BridgePluginRuntime
  if (mode === "embedded-agent") {
    const agentRuntime = params.runtime as unknown as EmbeddedAgentRuntime;
    const result = await dispatchEmbeddedAgentMessage({
      runtime: agentRuntime,
      channel: params.channel,
      accountId: params.accountId,
      peerId: params.peerId,
      text: params.text,
      agentId,
      sessionKey,
      sessionId: params.sessionId,
      timeoutMs: params.timeoutMs,
      reply: params.reply,
    });
    return { mode, ...result };
  }

  if (mode === "subagent") {
    const subRuntime = params.runtime as unknown as SubagentRuntime;
    const result = await dispatchSubagentMessage({
      runtime: subRuntime,
      channel: params.channel,
      accountId: params.accountId,
      peerId: params.peerId,
      text: params.text,
      agentId,
      sessionKey,
      childSessionKey: params.childSessionKey,
      timeoutMs: params.timeoutMs,
      replyEnabled: params.replyEnabled,
      reply: params.reply,
    });
    return { mode, ...result };
  }

  // 默认 reply-pipeline：保留 MQ wire envelope 契约，回复经 deliver 发布到原协议
  const wireResult = await dispatchWireMessage(
    {
      runtime,
      channel: params.channel,
      accountId: params.accountId,
      peerId: params.peerId,
      text: params.text,
      chatType: params.chatType,
      agentId,
      unified: params.unified,
      extra: params.extra,
      reply: {
        deliver: params.reply.deliver,
        outboundFormat: params.reply.outboundFormat,
        replyRoute: params.reply.replyRoute,
        agentId: params.reply.agentId ?? agentId,
        sessionKey: params.reply.sessionKey ?? sessionKey,
      },
    },
    wireOptions,
  );

  return { mode: "reply-pipeline", wireResult };
}

/** 重新导出 channel dispatch 核心类型 / Re-export channel dispatch types */
export type { ChannelDispatchMode, ChannelDispatchParams, ChannelDispatchResult };
