import type { OpenClawConfig } from "openclaw/plugin-sdk";

import { getWecomKfChannelBlock, warnWecomCsChannelDeprecation } from "./channel-block.js";

// 默认给一个相对“够用”的上限（80MB），避免视频/较大文件频繁触发失败。
// 仍保留上限以防止恶意大文件把进程内存打爆（下载实现会读入内存再保存）。
export const DEFAULT_WECOM_MEDIA_MAX_BYTES = 80 * 1024 * 1024;

export function resolveWecomMediaMaxBytes(cfg: OpenClawConfig): number {
  const block = getWecomKfChannelBlock(cfg);
  const raw = block?.media?.maxBytes;
  if (raw == null && cfg.channels?.["wecom-cs"]) {
    warnWecomCsChannelDeprecation();
  }
  const n = typeof raw === "number" ? raw : Number(raw);
  if (Number.isFinite(n) && n > 0) {
    return Math.floor(n);
  }
  return DEFAULT_WECOM_MEDIA_MAX_BYTES;
}
