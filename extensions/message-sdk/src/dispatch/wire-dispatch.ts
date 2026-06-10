/**
 * @module dispatch/wire-dispatch
 *
 * Wire 路径 dispatch facade：thin wrapper over bridge.dispatchInbound。
 *
 * **职责**：MQ、Stream、Webhook-to-Agent 等机器消费者场景的标准入站入口；
 * 保持 `dispatchInbound` 与 JSON envelope/replyRoute 契约；可选 InboundMessageQueue 做串接与幂等。
 *
 * **默认行为**：直接调用 `dispatchInbound`（useInboundQueue=false），避免改变高频 MQ 延迟模型。
 *
 * **关键导出**：`dispatchWireMessage`、`WireDispatchOptions`
 */

import {
  dispatchInbound,
  type DispatchInboundParams,
  type DispatchInboundResult,
} from "../bridge/inbound-bridge.js";
import { InboundMessageQueue } from "../queue/inbound-message-queue.js";
import type { WireDispatchConfig } from "./types.js";

/**
 * dispatchWireMessage 的可选运行参数 / Optional runtime options for wire dispatch.
 */
export interface WireDispatchOptions {
  /** 可选配置；当前仅声明 channelClass=wire / Wire dispatch config */
  config?: WireDispatchConfig;
  /** 启用入站队列（默认 false，保持 MQ 直派兼容）/ Enable inbound queue */
  useInboundQueue?: boolean;
  /** 自定义队列实例 / Custom inbound queue instance */
  inboundQueue?: InboundMessageQueue;
}

/**
 * Wire 路径入站派发（MQ 插件标准入口）/ Wire-path inbound dispatch entry.
 *
 * 行为等同 {@link dispatchInbound}；可选经 InboundMessageQueue 入队（默认关闭）。
 *
 * @param params - 与 dispatchInbound 一致的入站参数
 * @param options - 队列/配置选项；不传时直接 dispatchInbound
 * @returns dispatchInbound 结果；重复消息被队列去重时 ctx.skippedDuplicate=true
 */
export async function dispatchWireMessage(
  params: DispatchInboundParams,
  options?: WireDispatchOptions,
): Promise<DispatchInboundResult> {
  const useInboundQueue = options?.useInboundQueue ?? false;
  if (!useInboundQueue) {
    return dispatchInbound(params);
  }

  let dispatchResult: DispatchInboundResult | undefined;
  // 临时队列通过 onPush 立即派发；调用方注入持久队列时可自行控制队列生命周期
  const queue =
    options?.inboundQueue ??
    new InboundMessageQueue({
      onPush: async () => {
        dispatchResult = await dispatchInbound(params);
      },
    });

  if (params.unified) {
    // 优先用 UnifiedMessage.messageId 做幂等 key；没有统一消息时不能安全去重，直接派发
    const key =
      params.unified.messageId ||
      (typeof params.extra?.messageId === "string" ? params.extra.messageId : undefined);
    const accepted = await queue.push({
      message: params.unified,
      idempotencyKey: key,
      transportMeta: params.extra,
    });
    if (!accepted) {
      return {
        ctx: { skippedDuplicate: true },
        dispatcher: undefined,
        replyOptions: {},
      } as DispatchInboundResult;
    }
    return (
      dispatchResult ??
      ({
        ctx: {},
        dispatcher: undefined,
        replyOptions: {},
      } as DispatchInboundResult)
    );
  }

  return dispatchInbound(params);
}
