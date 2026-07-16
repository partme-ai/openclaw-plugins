import type { OpenClawConfig } from "openclaw/plugin-sdk/core";

/** Read-only setup helper. This plugin intentionally has no auto-enable wizard. */
export function getWechatIpadChannelSection(cfg: OpenClawConfig): Record<string, unknown> {
  return ((cfg.channels as Record<string, unknown> | undefined)?.["wechat-ipad"] ?? {}) as Record<
    string,
    unknown
  >;
}
