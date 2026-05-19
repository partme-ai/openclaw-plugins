/**
 * 出站处理模块。
 * 按会话上下文优先回复到绑定 replyTopic，否则回退标准 out topic。
 */

import { getSessionContext } from "./session-mapper.js";
import { publishToTopic } from "./ws-server.js";
import { getClientUsername } from "./ws-server.js";
import { isUserActionAllowed } from "./acl.js";
import { getWebMqttChannelConfig } from "./mqtt-state.js";

/**
 * 发布回复文本。
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

  publishToTopic(topic, text);
}
