/**
 * 企微微信客服渠道定义
 * 注册到 OpenClaw 的 Channel 对象，定义出站发送方式
 * 与 wecom 插件 channel 结构对齐
 */

import type { ChannelDefinition, WecomAccountConfig } from "./types/index.js";
import { getAccessToken, sendMessage } from "./agent/api-client.js";
import { listKfAccountIds, resolveKfAccount } from "./config/index.js";

/**
 * 企微微信客服渠道
 * 通过 api.registerChannel({ plugin: wecomKfChannel }) 注册
 */
export const wecomKfChannel: ChannelDefinition = {
  id: "wecom-kf",

  meta: {
    id: "wecom-kf",
    order: 50,
    label: "企业微信客服",
    selectionLabel: "企业微信客服 (WeChat KF API)",
    docsPath: "/channels/wecom-kf",
    blurb: "对接企微微信客服 API，AI 伪装为客服坐席。",
    aliases: ["wechat-kf", "wecom-kf"],

    recommendedConfig: {
      session: {
        dmScope: "per-account-channel-peer",
        resetByChannel: {
          "wecom-kf": { mode: "idle", idleMinutes: 2880 },
        },
      },
    },
  },

  capabilities: {
    chatTypes: ["direct"],
  },

  config: {
    listAccountIds: (cfg) => listKfAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveKfAccount(cfg, accountId),
  },

  outbound: {
    deliveryMode: "direct" as const,

    /**
     * Agent 回复时，通过企微 kf/send_msg 发给客户
     */
    sendText: async ({ text, to, account }): Promise<{ ok: boolean }> => {
      const accessToken = await getAccessToken(account.corpId, account.corpSecret);

      const result = await sendMessage(
        accessToken,
        to,
        account.openKfId,
        "text",
        { text: { content: text } }
      );

      if (result.errcode !== 0) {
        console.error(
          `[wecom_kf] send_msg failed: ${result.errmsg} (errcode: ${result.errcode})`
        );
      }

      return { ok: result.errcode === 0 };
    },
  },
};
