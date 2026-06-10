/**
 * 出站处理模块。
 * 按会话上下文优先回复到绑定 replyTopic，否则回退标准 out topic。
 */

import { getSessionContext } from "./routing/session-mapper.js";
import { publishToTopic, getClientUsername } from "./transport/server.js";
import { isUserActionAllowed } from "./transport/acl.js";
import { getWebMqttChannelConfig } from "./state/mqtt-state.js";

/**
 * 发布回复文本到 MQTT topic。
 *
 * @param sessionKey - OpenClaw 会话键（用于查找 replyTopic / client 上下文）
 * @param text - 出站文本内容
 * @param topicPrefix - 默认出站 topic 前缀（无 replyTopic 时使用）
 * @returns Promise；ACL 拒绝或无会话上下文时静默返回
 */
export async function publishOutboundText(sessionKey: string, text: string, topicPrefix: string): Promise<void> {
  const context = getSessionContext(sessionKey);
  if (!context) return;
  const topic = context.replyTopic ?? `${topicPrefix}agent/${context.agentId}/out`;

  const config = getWebMqttChannelConfig();
  if (config) {
    const username = getClientUsername(context.clientId);
    const user = config.auth.users.find((entry) => entry.username === username);
    if (
      user &&
      !isUserActionAllowed({
        user,
        action: "outbound",
        topic,
        accountId: context.accountId,
      })
    ) {
      return;
    }
  }

  await publishToTopic(topic, text);
}
