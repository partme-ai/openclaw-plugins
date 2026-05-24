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
 * @throws 不抛出；无订阅者时消息入队或丢弃由 transport 决定。
 */
export function publishOutboundMessage(destination: string, body: string): void {
  publishToDestination(destination, body);
}
