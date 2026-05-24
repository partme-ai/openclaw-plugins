/**
 * 抖音出站适配器：MEDIA 指令解析占位。
 */

import { createEmptyChannelResult } from "openclaw/plugin-sdk/channel-send-result";
import { parseMediaDirectives } from "./runtime/runtime-api.js";

const CHANNEL_ID = "douyin";

/**
 * 占位 `sendText`：解析 MEDIA 指令后返回空成功结果。
 */
export async function sendDouyinOutboundStub(text?: string): Promise<
  Awaited<ReturnType<typeof createEmptyChannelResult>>
> {
  if (text) {
    parseMediaDirectives(text);
  }
  return createEmptyChannelResult(CHANNEL_ID, {
    messageId: `douyin-outbound-stub-${Date.now()}`,
  });
}
