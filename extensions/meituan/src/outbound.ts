/**
 * 美团出站适配器占位。
 *
 * **架构角色**：满足 Channel outbound 契约；实际消息推送由美团 OpenAPI 完成。
 *
 * **关键依赖**：`./types`
 */

import type { SendTextParams } from "./types.js";

/**
 * 占位 sendText：不调用 OpenAPI，直接返回成功。
 *
 * @param _params 出站参数（当前未使用）
 * @returns `{ ok: true }`
 */
export async function meituanSendText(_params: SendTextParams): Promise<{ ok: boolean }> {
  return { ok: true };
}
