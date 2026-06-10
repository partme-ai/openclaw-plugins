/**
 * WeChat iPad Channel 定义模块
 *
 * 将 wechat-ipad 注册为 OpenClaw 的 Channel：
 * - meta: UI 展示与排序信息
 * - capabilities: 支持私聊和群聊
 * - outbound.sendText: Agent 回复时通过 iPad 协议服务发送到微信
 */

import type { ChannelDefinition } from "./types.js";
import { wechatIpadSetupAdapter, wechatIpadSetupWizard } from "./onboarding.js";
import { wechatIpadSendText } from "./outbound.js";

/**
 * WeChat iPad 渠道定义
 * Agent 的回复将通过此 channel 发送给微信用户
 */
export const wechatIpadChannel: ChannelDefinition = {
  id: "wechat-ipad",
  name: "WeChat iPad Protocol Bridge",

  meta: {
    id: "wechat-ipad",
    label: "微信 (iPad 协议)",
    selectionLabel: "WeChat via iPad Protocol",
    docsPath: "/channels/wechat-ipad",
    blurb: "Personal WeChat account integration via iPad protocol bridge.",
    aliases: ["wechat", "wechat-ipad", "wx-ipad"],
    order: 50,
  },

  capabilities: {
    chatTypes: ["direct", "group"],
  },

  setupWizard: wechatIpadSetupWizard,
  setup: wechatIpadSetupAdapter,

  config: {
    listAccountIds: () => ["default"],
    resolveAccount: () => ({}),
  },

  outbound: {
    sendText: wechatIpadSendText,
  },
};
