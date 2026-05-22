/**
 * 美团出站占位（OpenAPI 推送由平台侧完成）。
 */

import type { SendTextParams } from "./types.js";

/**
 * 占位 sendText。
 */
export async function meituanSendText(_params: SendTextParams): Promise<{ ok: boolean }> {
  return { ok: true };
}
