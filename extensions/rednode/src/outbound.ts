/**
 * @fileoverview Rednode 出站适配：MEDIA 指令解析占位。
 */

import { parseMediaDirectives } from "./runtime/runtime-api.js";
import type { SendTextParams } from "./types.js";

/**
 * @description 占位 sendText（解析 MEDIA 指令后返回 `{ ok: true }`）。
 */
export async function xhsSendText(params: SendTextParams): Promise<{ ok: boolean }> {
  const parsed = parseMediaDirectives(params.text);
  if (parsed.paths.length > 0) {
    // 媒体由 dispatch/outbound-reply 在 Agent 回复链路解析
  }
  void parsed.text;
  return { ok: true };
}
