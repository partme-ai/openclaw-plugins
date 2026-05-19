/**
 * 渠道配置写入适配（占位校验，与 OpenClaw setup 管线对齐）。
 */
import { createPatchedAccountSetupAdapter } from "openclaw/plugin-sdk/setup";

const CHANNEL_KEY = "douyin" as const;

export const douyinSetupAdapter = createPatchedAccountSetupAdapter({
  channelKey: CHANNEL_KEY,
  validateInput: () => null,
  buildPatch: () => ({}),
});
