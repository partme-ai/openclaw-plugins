/**
 * 美团出站适配器：解析 MEDIA 指令后占位发送。
 */

import { parseMediaDirectives } from "./runtime/runtime-api.js";
import type { SendTextParams } from "./types.js";

/**
 * 占位 sendText：剥离 MEDIA 指令后返回成功（OpenAPI 对称通道待接）。
 */
export async function meituanSendText(params: SendTextParams): Promise<{ ok: boolean }> {
  const parsed = parseMediaDirectives(params.text);
  if (parsed.paths.length > 0) {
    // 媒体路径由 dispatch/outbound-reply 在 Agent 回复链路中解析
  }
  void parsed.text;
  return { ok: true };
}
