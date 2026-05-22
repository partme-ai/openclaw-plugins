/**
 * MQTT Last Will 消息处理模块
 * 当设备意外断线时，Broker 自动发布 Will 消息
 *
 * 在 OpenClaw 场景中，Will 消息用于：
 * 1. 通知关联的 Agent 设备已掉线
 * 2. 触发自动化流程（如告警、重试、状态更新）
 * 3. 清理设备会话状态
 */

/** 客户端 Will 配置缓存 */
const clientWills = new Map<
  string,
  {
    topic: string;
    payload: string;
    qos: 0 | 1;
    retain: boolean;
    agentId?: string;
  }
>();

/**
 * 注册客户端的 Will 消息
 * 在客户端连接时记录其 Will 配置
 *
 * @param clientId - MQTT Client ID
 * @param will - Will 消息配置
 * @param agentId - 关联的 Agent ID
 */
export function registerClientWill(
  clientId: string,
  will: { topic: string; payload: string; qos: 0 | 1; retain: boolean },
  agentId?: string
): void {
  clientWills.set(clientId, { ...will, agentId });
  console.log(
    `[openclaw-mqtt] Will registered for client ${clientId} on topic ${will.topic}`
  );
}

/**
 * 处理客户端意外断线
 * 触发 Will 消息发布和相关清理
 *
 * @param clientId - 断线的客户端 ID
 * @param publishCallback - 发布消息回调
 * @returns Will 消息信息（如果有），null 表示无 Will 配置
 */
export function handleClientDisconnect(
  clientId: string,
  publishCallback: (topic: string, payload: string, qos: 0 | 1, retain: boolean) => void
): { agentId?: string; topic: string } | null {
  const will = clientWills.get(clientId);
  if (!will) return null;

  // 发布 Will 消息
  publishCallback(will.topic, will.payload, will.qos, will.retain);

  console.log(
    `[openclaw-mqtt] Will published for disconnected client ${clientId} on topic ${will.topic}`
  );

  // 清理 Will 缓存
  clientWills.delete(clientId);

  return {
    agentId: will.agentId,
    topic: will.topic,
  };
}

/**
 * 移除客户端的 Will 配置
 * 在客户端正常断开（发送 DISCONNECT 包）时调用，
 * 正常断开不触发 Will 消息
 *
 * @param clientId - MQTT Client ID
 */
export function removeClientWill(clientId: string): void {
  clientWills.delete(clientId);
}

/**
 * 获取所有已注册的 Will 信息
 * 用于监控和调试
 */
export function getAllWills(): Array<{
  clientId: string;
  topic: string;
  agentId?: string;
}> {
  const result: Array<{ clientId: string; topic: string; agentId?: string }> = [];

  for (const [clientId, will] of clientWills.entries()) {
    result.push({
      clientId,
      topic: will.topic,
      agentId: will.agentId,
    });
  }

  return result;
}
