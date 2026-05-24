/**
 * WeChat iPad 出站消息适配。
 */

import { sendMessage } from "./transport/ipad-bridge.js";
import { outboundFromText } from "./dispatch/message-converter.js";
import { getWxidBySessionKey, parseWxidFromSessionKey } from "./routing/session-mapper.js";

/**
 * 发送文本消息给微信用户/群。
 * 当 Agent 回复时由 OpenClaw 调用。
 *
 * @param sessionKey - OpenClaw 会话键（格式：wechat-ipad:{wxid}@{agentId}）
 * @param text - Agent 回复的文本内容
 */
export async function wechatIpadSendText(
  sessionKey: string,
  text: string,
): Promise<void> {
  const wxid = getWxidBySessionKey(sessionKey) ?? parseWxidFromSessionKey(sessionKey);
  if (!wxid) {
    console.error(
      `[wechat-ipad] Cannot resolve wxid from sessionKey: ${sessionKey}`,
    );
    return;
  }

  const request = outboundFromText(wxid, text);
  const result = await sendMessage(request);
  if (!result.ok) {
    console.error(
      `[wechat-ipad] Failed to send message to ${wxid}: ${result.error}`,
    );
    return;
  }

  console.log(
    `[wechat-ipad] Reply sent to ${wxid} (${text.slice(0, 50)}...)`,
  );
}
