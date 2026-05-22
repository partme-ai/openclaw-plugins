/**
 * Wire 通道统一 dispatch 路由：按 mode 选择 reply-pipeline / embedded-agent / subagent。
 */

import { resolveChannelDispatchIdentity } from "../bridge/resolve-channel-route.js";
import type { BridgePluginRuntime } from "../bridge/types.js";
import { createWireDispatch, type CreateWireDispatchOptions } from "./wire-dispatch.js";
import { createEmbeddedAgentDispatch } from "./embedded-dispatch.js";
import { createSubagentDispatch } from "./subagent-dispatch.js";
import type {
  ChannelDispatchMode,
  ChannelDispatchParams,
  ChannelDispatchResult,
  EmbeddedAgentRuntime,
  SubagentRuntime,
} from "./types.js";

/**
 * 按 dispatch.mode 将入站消息路由到对应 SDK 实现。
 * sessionKey / agentId 未提供时经 OpenClaw resolveAgentRoute 解析。
 */
export async function createChannelDispatch(
  params: ChannelDispatchParams,
  wireOptions?: CreateWireDispatchOptions,
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

  if (mode === "embedded-agent") {
    const agentRuntime = params.runtime as unknown as EmbeddedAgentRuntime;
    const result = await createEmbeddedAgentDispatch({
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
    const result = await createSubagentDispatch({
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

  const wireResult = await createWireDispatch(
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

export type { ChannelDispatchMode, ChannelDispatchParams, ChannelDispatchResult };
