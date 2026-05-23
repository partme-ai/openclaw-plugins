import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { resolveChannelMediaMaxBytes } from "@partme.ai/openclaw-message-sdk/config";

import { WECOM_KF_CHANNEL_ID } from "./channel-block.js";

/** 默认媒体上限（80MB），兼顾视频/较大文件；仍设上限防止恶意大文件拖垮内存。 */
export const DEFAULT_WECOM_MEDIA_MAX_BYTES = 80 * 1024 * 1024;

/**
 * 解析 WeCom KF 通道媒体最大字节数（委托 message-sdk）。
 *
 * @param cfg OpenClaw 全局配置（读取 channels.wecom-kf.media.maxBytes 等）
 */
export function resolveWecomMediaMaxBytes(cfg: OpenClawConfig): number {
  return resolveChannelMediaMaxBytes({
    channelId: WECOM_KF_CHANNEL_ID,
    cfg,
    channelDefaultBytes: DEFAULT_WECOM_MEDIA_MAX_BYTES,
  });
}
