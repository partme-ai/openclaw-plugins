/**
 * Web STOMP 出站 publish 薄封装。
 */
import { publishToDestination } from "./transport/server.js";

/**
 * 向 STOMP destination 发布消息体。
 */
export function publishOutboundMessage(destination: string, body: string): void {
  const delivered = publishToDestination(destination, body);
  if (delivered < 1) {
    throw new Error(`No Web STOMP subscriber accepted destination: ${destination}`);
  }
}
