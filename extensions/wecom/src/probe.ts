/**
 * 企业微信账号连通性探测（OpenClaw channel-status 对齐）。
 */

import { formatErrorMessage } from "./runtime-api.js";
import { getAccessToken } from "./agent/api-client.js";
import { getWeComWebSocket } from "./state-manager.js";
import type { ResolvedWeComAccount } from "./utils.js";

export type WecomProbeResult = {
  ok: boolean;
  status: number;
  error?: string;
};

/** 探测 Agent gettoken 或 Bot 凭证 + WS 状态 */
export async function probeWeComAccount(account: ResolvedWeComAccount): Promise<WecomProbeResult> {
  if (account.agent?.configured && account.agent.corpId?.trim() && account.agent.corpSecret?.trim()) {
    try {
      await getAccessToken(account.agent);
      return { ok: true, status: 200 };
    } catch (err) {
      return { ok: false, status: 401, error: await formatErrorMessage(err) };
    }
  }

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
