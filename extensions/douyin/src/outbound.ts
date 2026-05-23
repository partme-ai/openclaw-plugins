/**
 * 抖音出站占位：直连发消息需走抖店/OpenAPI；此处返回空成功结果以保持渠道契约。
 */

import { createEmptyChannelResult } from "openclaw/plugin-sdk/channel-send-result";

const CHANNEL_ID = "douyin";

/**
 * 占位 sendText：无对称 DM 通道时的空结果。
 */
export async function sendDouyinOutboundStub(): Promise<
  Awaited<ReturnType<typeof createEmptyChannelResult>>
> {
  return createEmptyChannelResult(CHANNEL_ID, {
    messageId: `douyin-outbound-stub-${Date.now()}`,
  });
}
