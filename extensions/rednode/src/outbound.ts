/**
 * @fileoverview Rednode 出站适配占位：后续对接小红书开放平台消息发送 API。
 *
 * @description
 * 当前为 no-op 成功返回，满足 Channel outbound 契约；真实 API 集成时在本模块扩展。
 *
 * @module outbound
 */

/**
 * Rednode 出站 — Base Profile 入口。
 */

import type { SendTextParams } from "./types.js";

/**
 * @description 占位 sendText（始终返回 `{ ok: true }`）。
 * @param _params - 出站参数（暂未使用）。
 * @returns 发送结果占位对象。
 * @throws 不抛出。
 */
export async function xhsSendText(_params: SendTextParams): Promise<{ ok: boolean }> {
  return { ok: true };
}
