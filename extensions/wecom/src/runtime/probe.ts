/**
 * 企业微信账号连通性探测（probe）
 *
 * 对齐 OpenClaw channel-status.probeAccount 契约：
 * - Agent：调用 getAccessToken 验证 corpId/corpSecret
 * - Bot：检查 botId+secret 是否配置，并报告 WebSocket 连接状态（未连仍视为 ok+warning）
 *
 * 错误文案经 runtime-api `formatErrorMessage`（message-sdk）格式化。
 */

import { formatErrorMessage } from "./runtime-api.js";
import { getAccessToken } from "../agent/api-client.js";
import { getWeComWebSocket } from "../state/state-manager.js";
import type { ResolvedWeComAccount } from "../config/wecom-config.js";

/** channel-status 探测结果 */
export type WecomProbeResult = {
  ok: boolean;
  status: number;
  error?: string;
};

/**
 * 探测单个已解析账号的连通性。
 *
 * @param account 由 resolveWeComAccountMulti 得到的账号快照
 */
export async function probeWeComAccount(account: ResolvedWeComAccount): Promise<WecomProbeResult> {
  // Agent 模式：以 gettoken 成功与否作为凭据有效性探针
  if (account.agent?.configured && account.agent.corpId?.trim() && account.agent.corpSecret?.trim()) {
    try {
      await getAccessToken(account.agent);
      return { ok: true, status: 200 };
    } catch (err) {
      return { ok: false, status: 401, error: await formatErrorMessage(err) };
    }
  }

  // Bot 模式：凭据存在即可；WS 未连时在 error 字段附带说明（仍 ok:true）
  const botId = account.botId?.trim();
  const secret = account.secret?.trim();
  if (botId && secret) {
    const ws = getWeComWebSocket(account.accountId);
    if (ws?.isConnected) {
      return { ok: true, status: 200 };
    }
    return {
      ok: true,
      status: 200,
      error: "bot credentials configured; websocket not connected",
    };
  }

  return { ok: false, status: 400, error: "WeCom bot or agent credentials not configured" };
}
