/**
 * STOMP ACK/NACK 消息确认处理模块
 * 管理消息投递确认，支持 auto/client/client-individual 三种模式
 *
 * ACK 模式说明：
 * - auto: 服务端发送后即视为已确认（无需客户端 ACK）
 * - client: 客户端 ACK 某消息后，该消息及之前的所有消息都视为已确认
 * - client-individual: 客户端必须逐条 ACK 每个消息
 */

/** 待确认消息：messageId -> 消息元数据 */
const pendingMessages = new Map<
  string,
  {
    subscriptionId: string;
    connectionId: string;
    destination: string;
    sentAt: number;
    ackMode: "client" | "client-individual";
  }
>();

/** 消息 ID 计数器 */
let messageIdCounter = 0;

/**
 * 生成消息 ID 并注册待确认
 * 仅在 ACK 模式非 auto 时注册
 *
 * @param subscriptionId - 订阅 ID
 * @param connectionId - 连接 ID
 * @param destination - 目标 Destination
 * @param ackMode - ACK 模式
 * @returns 生成的消息 ID
 */
export function registerMessage(
  subscriptionId: string,
  connectionId: string,
  destination: string,
  ackMode: "auto" | "client" | "client-individual"
): string {
  const messageId = `msg-${++messageIdCounter}`;

  // auto 模式不需要追踪
  if (ackMode === "auto") return messageId;

  pendingMessages.set(messageId, {
    subscriptionId,
    connectionId,
    destination,
    sentAt: Date.now(),
    ackMode,
  });

  return messageId;
}

/**
 * 处理客户端 ACK
 * 根据 ACK 模式确认一条或多条消息
 *
 * @param messageId - 被确认的消息 ID
 * @returns 被确认的消息数量
 */
export function handleAck(messageId: string): number {
  const msg = pendingMessages.get(messageId);
  if (!msg) return 0;

  if (msg.ackMode === "client-individual") {
    // 仅确认该条消息
    pendingMessages.delete(messageId);
    return 1;
  }

  // client 模式：确认该消息及之前同一订阅的所有消息
  let count = 0;
  const targetSentAt = msg.sentAt;
  const targetSubId = msg.subscriptionId;
  const targetConnId = msg.connectionId;

  for (const [id, pending] of pendingMessages.entries()) {
    if (
      pending.connectionId === targetConnId &&
      pending.subscriptionId === targetSubId &&
      pending.sentAt <= targetSentAt
    ) {
      pendingMessages.delete(id);
      count++;
    }
  }

  return count;
}

/**
 * 处理客户端 NACK
 * 消息被拒绝，可选择重新投递或丢弃
 *
 * @param messageId - 被拒绝的消息 ID
 * @returns 被拒绝消息的元数据，null 表示消息不存在
 */
export function handleNack(
  messageId: string
): {
  subscriptionId: string;
  connectionId: string;
  destination: string;
} | null {
  const msg = pendingMessages.get(messageId);
  if (!msg) return null;

  pendingMessages.delete(messageId);

  return {
    subscriptionId: msg.subscriptionId,
    connectionId: msg.connectionId,
    destination: msg.destination,
  };
}

/**
 * 清理连接相关的所有待确认消息
 *
 * @param connectionId - WebSocket 连接 ID
 */
export function cleanupConnection(connectionId: string): void {
  const toRemove: string[] = [];

  for (const [id, msg] of pendingMessages.entries()) {
    if (msg.connectionId === connectionId) {
      toRemove.push(id);
    }
  }

  for (const id of toRemove) {
    pendingMessages.delete(id);
  }
}

/**
 * 获取 ACK 统计
 */
export function getAckStats(): {
  pendingCount: number;
  oldestPendingMs: number | null;
} {
  let oldest: number | null = null;
  const now = Date.now();

  for (const msg of pendingMessages.values()) {
    const age = now - msg.sentAt;
    if (oldest === null || age > oldest) {
      oldest = age;
    }
  }

  return {
    pendingCount: pendingMessages.size,
    oldestPendingMs: oldest,
  };
}
