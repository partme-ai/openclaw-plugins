/**
 * Wire 路径 dispatch facade：thin wrapper over bridge.dispatchInbound。
 *
 * Wire 路径用于 MQ、Stream、Webhook-to-Agent 等机器消费者场景。它不保证
 * Control UI transcript，而是保持现有 `dispatchInbound` 与 JSON envelope/replyRoute 契约。
 * 可选队列只做入站串接与幂等过滤，默认关闭以避免改变高频 MQ 插件的延迟模型。
 */

import {
  dispatchInbound,
  type DispatchInboundParams,
  type DispatchInboundResult,
} from "../bridge/inbound-bridge.js";
import { InboundMessageQueue } from "../queue/inbound-message-queue.js";
import type { WireDispatchConfig } from "./types.js";

/**
 * dispatchWireMessage 的可选运行参数。
 *
 * @property config - Wire 路径配置，目前仅用于标注 channelClass。
 * @property useInboundQueue - 是否先进入 `InboundMessageQueue`，默认 `false`。
 * @property inboundQueue - 调用方注入的队列实例；缺省时临时创建一个只处理当前消息的队列。
 */
export interface WireDispatchOptions {
  /** 可选配置；当前仅声明 channelClass=wire，行为与 dispatchInbound 一致。 */
  config?: WireDispatchConfig;
  /** 启用入站队列（默认 false，保持 MQ 直派兼容）。 */
  useInboundQueue?: boolean;
  /** 自定义队列实例；未提供时在 useInboundQueue=true 时创建临时队列。 */
  inboundQueue?: InboundMessageQueue;
}

/**
 * Wire 路径入站派发（MQ 插件标准入口）。
 *
 * 行为等同 {@link dispatchInbound}；可选经 InboundMessageQueue 入队（默认关闭）。
 *
 * @param params - 与 `dispatchInbound` 一致的入站参数，包含 Runtime、通道、peer、文本和 reply deliver。
 * @param options - 队列/配置选项；不传时直接调用 `dispatchInbound`。
 * @returns `dispatchInbound` 的结果；重复消息被队列去重时返回 `skippedDuplicate` 标记。
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
  // 临时队列通过 onPush 立即派发；调用方注入持久队列时可自行控制队列生命周期。
  const queue =
    options?.inboundQueue ??
    new InboundMessageQueue({
      onPush: async () => {
        dispatchResult = await dispatchInbound(params);
      },
    });

  if (params.unified) {
    // 优先用 UnifiedMessage.messageId 做幂等 key；没有统一消息时不能安全去重，直接派发。
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
