/**
 * 抖音出站适配器占位。
 *
 * **架构角色**：满足 OpenClaw 渠道出站契约；抖音 DM 无对称 Webhook 回推通道，
 * 实际发消息需走抖店/OpenAPI 或 `douyin-cli`。
 *
 * **关键依赖**：`openclaw/plugin-sdk/channel-send-result`
 */

import { createEmptyChannelResult } from "openclaw/plugin-sdk/channel-send-result";

const CHANNEL_ID = "douyin";

/**
 * 占位 `sendText`：无对称 DM 通道时返回空成功结果，避免渠道管线报错。
 *
 * @returns 带 stub messageId 的空 ChannelResult
 */
export async function sendDouyinOutboundStub(): Promise<
  Awaited<ReturnType<typeof createEmptyChannelResult>>
> {
  return createEmptyChannelResult(CHANNEL_ID, {
    messageId: `douyin-outbound-stub-${Date.now()}`,
  });
}
