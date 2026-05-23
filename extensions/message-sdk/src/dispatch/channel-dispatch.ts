/**
 * Wire 通道统一 dispatch 路由：按 mode 选择 reply-pipeline / embedded-agent / subagent。
 *
 * 该文件是 MQ/机器通道的统一入口。具体插件只负责解析传输协议并提供
 * `deliver` 回调，真正的 Agent 路由、sessionKey 解析、运行模式分流都在这里完成。
 * 这样 RabbitMQ、MQTT、Redis Stream、STOMP 等插件不会重复维护各自的派发逻辑。
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
 * 按 dispatch.mode 将入站消息路由到对应 SDK 实现。
 *
 * - `reply-pipeline`：走 OpenClaw 原有 `dispatchInbound`/reply pipeline，适合传统 MQ。
 * - `embedded-agent`：在当前进程内运行 Agent 后把结果序列化回传输层。
 * - `subagent`：创建子 Agent run，并可选等待回复再投递。
 *
 * sessionKey / agentId 未提供时经 OpenClaw `resolveAgentRoute` 解析。
 *
 * @param params - 通道、账号、peer、文本、运行模式、Runtime 和回复投递配置。
 * @param wireOptions - 仅 reply-pipeline 使用的 Wire 队列选项；默认直接派发。
 * @returns 当前模式对应的派发结果；reply-pipeline 返回底层 `dispatchInbound` 结果。
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

  // Embedded/subagent 模式需要更强的 Runtime 能力，这里只在对应分支收窄类型。
  // 这样普通 MQ 插件仍可传入最小 BridgePluginRuntime，不被 agent/subagent API 绑定。
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

  // 默认路径保留 MQ 的 wire envelope 契约：Agent 回复先由 reply pipeline 处理，
  // 再通过插件提供的 deliver 回调发布到原协议的 reply topic / stream / queue。
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

/**
 * 重新导出 channel dispatch 的核心类型，方便调用方从实现文件或 barrel 中按需导入。
 */
export type { ChannelDispatchMode, ChannelDispatchParams, ChannelDispatchResult };
