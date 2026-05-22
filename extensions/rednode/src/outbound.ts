/**
 * 小红书出站占位。
 */

import type { SendTextParams } from "./types.js";

/**
 * 占位 sendText。
 */
export async function xhsSendText(_params: SendTextParams): Promise<{ ok: boolean }> {
  return { ok: true };
}
