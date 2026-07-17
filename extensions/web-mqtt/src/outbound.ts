/**
 * 出站处理模块。
 * 按会话上下文优先回复到绑定 replyTopic，否则回退标准 out topic。
 */

import { getSessionContext } from "./routing/session-mapper.js";
import { publishToTopic, getClientUsername } from "./transport/server.js";
import { isUserActionAllowed } from "./transport/acl.js";
import { getWebMqttChannelConfig } from "./state/mqtt-state.js";

const DIRECT_TARGET_PREFIX = "openclaw-direct-topic:v1:";

/**
 * 解析 Router/Bridge 内部使用的显式 Topic 目标编码。
 *
 * 普通目标返回 `null` 以继续标准会话路由；带内部前缀但为空或 URL 编码损坏时必须抛错，
 * 防止错误目标静默回退后把消息发送到非预期 Topic。外部 MQTT 客户端不应构造该契约。
 */
export function parseDirectTarget(value: string): string | null {
  if (!value.startsWith(DIRECT_TARGET_PREFIX)) return null;
  const encoded = value.slice(DIRECT_TARGET_PREFIX.length);
  if (!encoded) throw new Error("[openclaw-web-mqtt] Explicit direct target is empty");
  try {
    const target = decodeURIComponent(encoded);
    if (!target) throw new Error("empty target");
    return target;
  } catch (error) {
    throw new Error(`[openclaw-web-mqtt] Invalid explicit direct target: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 发布回复文本到 MQTT topic。
 *
 * @param sessionKey - OpenClaw 会话键（用于查找 replyTopic / client 上下文）
 * @param text - 出站文本内容
 * @param topicPrefix - 默认出站 topic 前缀（无 replyTopic 时使用）
 * @returns 发布成功时 resolve；缺会话、缺认证身份、ACL 拒绝或无订阅者时 reject
 */
export async function publishOutboundText(sessionKey: string, text: string, topicPrefix: string): Promise<void> {
  const context = getSessionContext(sessionKey);
  if (!context) throw new Error(`[openclaw-web-mqtt] Missing session context: ${sessionKey}`);
  const topic = context.replyTopic ?? `${topicPrefix}agent/${context.agentId}/out`;

  const config = getWebMqttChannelConfig();
  if (config?.auth.required) {
    const username = getClientUsername(context.clientId);
    const user = config.auth.users.find((entry) => entry.username === username);
    if (
      !user ||
      !isUserActionAllowed({
          user,
          action: "outbound",
          topic,
          accountId: context.accountId,
        })
    ) {
      throw new Error(
        `[openclaw-web-mqtt] ${user ? "Outbound ACL denied" : "Authenticated identity missing"} for topic: ${topic}`,
      );
    }
  }

  const delivered = await publishToTopic(topic, text);
  if (delivered < 1) throw new Error(`[openclaw-web-mqtt] No active subscriber accepted topic: ${topic}`);
}

/** 可信 Router/Bridge 的显式 Topic 投递；外部客户端不得直接调用此内部契约。 */
export async function publishDirectText(topic: string, text: string): Promise<void> {
  const delivered = await publishToTopic(topic, text);
  if (delivered < 1) throw new Error(`[openclaw-web-mqtt] No active subscriber accepted topic: ${topic}`);
}
