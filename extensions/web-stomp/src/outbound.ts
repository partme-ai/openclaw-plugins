/**
 * Web STOMP 出站 publish 薄封装。
 */
import { publishToDestination } from "./transport/server.js";

/**
 * 向 STOMP destination 发布消息体。
 */
export async function publishOutboundMessage(destination: string, body: string): Promise<void> {
  const delivered = await publishToDestination(destination, body);
  if (delivered < 1) {
    throw new Error(`No Web STOMP subscriber accepted destination: ${destination}`);
  }
}
