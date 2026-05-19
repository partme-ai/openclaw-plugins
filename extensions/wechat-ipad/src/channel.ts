/**
 * WeChat iPad Channel 定义模块
 *
 * 将 wechat-ipad 注册为 OpenClaw 的 Channel：
 * - meta: UI 展示与排序信息
 * - capabilities: 支持私聊和群聊
 * - outbound.sendText: Agent 回复时通过 iPad 协议服务发送到微信
 *
 * 出站消息流程：
 *   Agent 回复 → OpenClaw → channel.outbound.sendText
 *     → 解析 sessionKey 获取 wxid → iPad Bridge HTTP API 发送
 */

import type { ChannelDefinition } from "./types.js";
import { sendMessage } from "./ipad-bridge.js";
import { getWxidBySessionKey, parseWxidFromSessionKey } from "./session-mapper.js";
import { outboundFromText } from "./message-converter.js";

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

  config: {
    /**
     * 列出账户 ID 列表
     * iPad 协议一次登录一个微信号，使用 "default" 即可
     */
    listAccountIds: () => ["default"],

    /**
     * 解析账户配置
     */
    resolveAccount: () => ({}),
  },

  outbound: {
    /**
     * 发送文本消息给微信用户/群
     * 当 Agent 回复时由 OpenClaw 调用
     *
     * @param sessionKey - OpenClaw 会话键（格式：wechat-ipad:{wxid}@{agentId}）
     * @param text - Agent 回复的文本内容
     */
    sendText: async (sessionKey: string, text: string): Promise<void> => {
      // 从 sessionKey 中解析出目标 wxid
      const wxid = getWxidBySessionKey(sessionKey) ?? parseWxidFromSessionKey(sessionKey);
      if (!wxid) {
        console.error(
          `[wechat-ipad] Cannot resolve wxid from sessionKey: ${sessionKey}`
        );
        return;
      }

      // 构造发送请求
      const request = outboundFromText(wxid, text);

      // 通过 iPad 协议服务发送
      const result = await sendMessage(request);
      if (!result.ok) {
        console.error(
          `[wechat-ipad] Failed to send message to ${wxid}: ${result.error}`
        );
        return;
      }

      console.log(
        `[wechat-ipad] Reply sent to ${wxid} (${text.slice(0, 50)}...)`
      );
    },
  },
};
