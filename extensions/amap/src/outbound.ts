/**
 * 高德出站适配（Outbound Adapter）
 *
 * **架构角色**：实现 Channel `outbound.sendText` 契约。
 * 高德公域消息的 REST 推送由开放平台 / OpenAPI 完成，此处为占位实现以保持接口兼容。
 *
 * **关键依赖**：`./types` — `SendTextParams` 出站参数类型
 */

import type { SendTextParams } from "./types.js";

/**
 * 占位 sendText：不发起实际 HTTP 推送，始终返回成功。
 *
 * @param _params - 出站文本与目标（当前未使用）
 * @returns `{ ok: true }` 表示契约层成功
 */
export async function amapSendText(_params: SendTextParams): Promise<{ ok: boolean }> {
  return { ok: true };
}
