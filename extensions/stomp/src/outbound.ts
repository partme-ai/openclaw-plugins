/**
 * @fileoverview STOMP 出站薄封装：向 destination 发布 MESSAGE 帧。
 *
 * @description
 * Channel outbound 与 inbound reply deliver 均委托 transport `publishToDestination`。
 *
 * @module outbound
 */

/**
 * STOMP 出站 — Base Profile 入口。
 */

import { publishToDestination } from "./transport/server.js";

/**
 * @description 向 STOMP destination 发布消息体。
 * @param destination - STOMP destination（如 `/topic/session.xxx`）。
 * @param body - 消息正文。
 * @returns void
 * @throws 没有在线或进程内 durable 订阅接受消息时抛出，供 Router/调用方重试或 DLQ。
 */
export function publishOutboundMessage(destination: string, body: string): void {
  const accepted = publishToDestination(destination, body);
  if (accepted < 1) {
    // 公共薄封装必须与 Channel Adapter 的成功语义一致；静默返回会让上层误删 Outbox 任务。
    throw new Error(`No STOMP subscriber accepted outbound destination: ${destination}`);
  }
}
