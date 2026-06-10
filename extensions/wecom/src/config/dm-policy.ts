/**
 * @module dm-policy
 *
 * 企业微信私聊（DM）访问控制 — message-sdk 薄封装。
 *
 * **职责**：根据 `channels.wecom.dmPolicy`（open / allowlist / pairing / disabled）
 * 判定私聊是否放行；pairing 模式下创建配对请求并通过 **WS replyStream** 下发配对码。
 *
 * **适用场景**：WS Bot 入站 `monitor.prepareWeComMessage` Step 3；Webhook 链路使用
 * `checkWecomDmPolicy` 并注入各自的 `sendPairingReply`。
 *
 * **上下游**：
 * - 上游：`@partme.ai/openclaw-message-sdk/ingress` `checkChannelDmPolicy`
 * - 下游：OpenClaw pairing 存储、`message-sender.sendWeComReply`
 *
 * **关键导出**：`checkDmPolicy`、`checkWecomDmPolicy`、`buildWecomPairingReplyText`
 */

import type { RuntimeEnv } from "openclaw/plugin-sdk/runtime-env";
import type { WSClient, WsFrame } from "@wecom/aibot-node-sdk";
import {
  checkChannelDmPolicy,
  type DmPolicyCheckResult,
} from "@partme.ai/openclaw-message-sdk/ingress";
import { getWeComRuntime } from "../runtime.js";
import { CHANNEL_ID } from "../types/const.js";
import type { ResolvedWeComAccount } from "./wecom-config.js";
import { sendWeComReply } from "../dispatch/message-sender.js";

export type { DmPolicyCheckResult };

/** WeCom DM 策略检查公共参数（由 WS / Webhook 各自注入 sendPairingReply） */
type WecomDmPolicyBaseParams = {
  senderId: string;
  isGroup: boolean;
  account: ResolvedWeComAccount;
  runtime: RuntimeEnv;
  logPrefix?: string;
  sendPairingReply: (params: { senderId: string; code: string }) => Promise<void>;
};

/**
 * WeCom DM 策略检查（注入 pairing 回复通道：WS / Webhook / Agent API）。
 *
 * **pairing 存储兼容**：同时读取 legacy `"wecom"` 与新版 `{ channel, accountId }` 两种 store 键。
 *
 * @param params.senderId - 发送者 userid
 * @param params.isGroup - 是否群聊（群聊始终放行）
 * @param params.account - 已解析账号（含 dmPolicy / allowFrom）
 * @param params.runtime - 运行时日志
 * @param params.sendPairingReply - pairing 模式下发送配对码
 * @returns 是否允许继续处理
 */
export async function checkWecomDmPolicy(
  params: WecomDmPolicyBaseParams,
): Promise<DmPolicyCheckResult> {
  const { senderId, isGroup, account, runtime, sendPairingReply } = params;
  const core = getWeComRuntime();
  const logPrefix = params.logPrefix ?? "[WeCom]";

  return checkChannelDmPolicy({
    channelId: CHANNEL_ID,
    senderId,
    isGroup,
    accountId: account.accountId,
    dmPolicy: account.config.dmPolicy,
    configAllowFrom: account.config.allowFrom,
    runtime,
    logPrefix,
    readPairingAllowFrom: async ({ channelId, accountId }) => {
      const readLegacyAllowFrom = core.channel.pairing.readAllowFromStore as (
        channelOrParams: string | { channel: string; accountId?: string },
        env?: unknown,
        legacyAccountId?: string,
      ) => Promise<string[]>;
      const oldStoreAllowFrom = await readLegacyAllowFrom(
        "wecom",
        undefined,
        accountId,
      ).catch(() => []);
      const newStoreAllowFrom = await readLegacyAllowFrom({
        channel: channelId,
        accountId,
      }).catch(() => []);
      return [...oldStoreAllowFrom, ...newStoreAllowFrom];
    },
    upsertPairingRequest: async ({ channelId, senderId: id, accountId }) => {
      const { code, created } = await core.channel.pairing.upsertPairingRequest({
        channel: channelId,
        id,
        accountId,
        meta: { name: id },
      });
      return { code, created };
    },
    sendPairingReply: async ({ senderId: id, code }) => {
      await sendPairingReply({ senderId: id, code });
    },
  });
}

/**
 * 构建 pairing 模式下的用户可见回复文案。
 *
 * @param senderId - 用户 userid（展示在 idLine）
 * @param code - 配对码
 * @returns OpenClaw 标准 pairing 回复文本
 */
export function buildWecomPairingReplyText(senderId: string, code: string): string {
  const core = getWeComRuntime();
  return core.channel.pairing.buildPairingReply({
    channel: CHANNEL_ID,
    idLine: `您的企业微信用户ID: ${senderId}`,
    code,
  });
}

/**
 * 检查 DM Policy 访问控制（WebSocket Bot 专用入口）。
 *
 * pairing 回复通过 `sendWeComReply` + 当前入站 frame 被动发送。
 *
 * @param params.senderId - 发送者 userid
 * @param params.isGroup - 是否群聊
 * @param params.account - 已解析账号
 * @param params.wsClient - WS 客户端
 * @param params.frame - 当前入站帧（pairing 回复关联 req_id）
 * @param params.runtime - 运行时日志
 * @returns 策略检查结果
 */
export async function checkDmPolicy(params: {
  senderId: string;
  isGroup: boolean;
  account: ResolvedWeComAccount;
  wsClient: WSClient;
  frame: WsFrame;
  runtime: RuntimeEnv;
}): Promise<DmPolicyCheckResult> {
  const { senderId, isGroup, account, wsClient, frame, runtime } = params;

  return checkWecomDmPolicy({
    senderId,
    isGroup,
    account,
    runtime,
    sendPairingReply: async ({ senderId: id, code }) => {
      await sendWeComReply({
        wsClient,
        frame,
        text: buildWecomPairingReplyText(id, code),
        runtime,
        finish: true,
      });
    },
  });
}
