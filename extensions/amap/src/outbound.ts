/**
 * 高德出站占位：REST 推送由平台/OpenAPI 完成，此处保持契约兼容。
 */

import type { SendTextParams } from "./types.js";

/**
 * 占位 sendText。
 */
export async function amapSendText(_params: SendTextParams): Promise<{ ok: boolean }> {
  return { ok: true };
}
