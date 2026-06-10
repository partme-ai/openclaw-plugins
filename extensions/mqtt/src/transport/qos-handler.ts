/**
 * @module mqtt/transport/qos-handler
 *
 * QoS 消息确认处理模块
 * 管理 MQTT QoS 0/1 级别的消息投递保证
 *
 * - QoS 0: 最多一次投递（fire and forget）
 * - QoS 1: 至少一次投递（需要 PUBACK 确认）
 * - QoS 2: 不支持（IoT 场景下 QoS 1 已足够）
 */

/** 等待确认的消息 Map：messageId -> 消息信息 */
const pendingAcks = new Map<
  number,
  {
    topic: string;
    payload: string;
    clientId: string;
    sentAt: number;
    retryCount: number;
  }
>();

/** 消息 ID 计数器 */
let messageIdCounter = 0;

/** 最大重试次数 */
const MAX_RETRIES = 3;

/** 重试间隔（毫秒） */
const RETRY_INTERVAL_MS = 5_000;

/** 定时重试检查器 */
let retryTimer: ReturnType<typeof setInterval> | null = null;

/**
 * 初始化 QoS 处理器
 * 启动重试检查定时器
 *
 * @param retryCallback - 重试发送回调
 */
export function initQosHandler(
  retryCallback: (topic: string, payload: string, messageId: number) => void
): void {
  // 启动定时重试
  retryTimer = setInterval(() => {
    const now = Date.now();

    for (const [messageId, pending] of pendingAcks.entries()) {
      // 超过重试间隔则重发
      if (now - pending.sentAt > RETRY_INTERVAL_MS) {
        if (pending.retryCount >= MAX_RETRIES) {
          // 超过最大重试次数，放弃
          console.warn(
            `[openclaw-mqtt] QoS1 message ${messageId} to ${pending.clientId} dropped after ${MAX_RETRIES} retries`
          );
          pendingAcks.delete(messageId);
          continue;
        }

        // 重试发送
        pending.retryCount++;
        pending.sentAt = now;
        console.log(
          `[openclaw-mqtt] QoS1 retry #${pending.retryCount} for message ${messageId}`
        );
        retryCallback(pending.topic, pending.payload, messageId);
      }
    }
  }, RETRY_INTERVAL_MS);
}

/**
 * 注册一个 QoS 1 消息等待确认
 *
 * @param topic - 消息 Topic
 * @param payload - 消息内容
 * @param clientId - 目标客户端 ID
 * @returns 分配的消息 ID
 */
export function registerPendingAck(
  topic: string,
  payload: string,
  clientId: string
): number {
  const messageId = ++messageIdCounter;

  pendingAcks.set(messageId, {
    topic,
    payload,
    clientId,
    sentAt: Date.now(),
    retryCount: 0,
  });

  return messageId;
}

/**
 * 确认消息已被接收（处理 PUBACK）
 *
 * @param messageId - 要确认的消息 ID
 */
export function acknowledgeMessage(messageId: number): void {
  if (pendingAcks.has(messageId)) {
    pendingAcks.delete(messageId);
  }
}

/**
 * 获取待确认消息统计
 */
export function getPendingAckStats(): {
  pendingCount: number;
  oldestPendingMs: number | null;
} {
  let oldest: number | null = null;
  const now = Date.now();

  for (const pending of pendingAcks.values()) {
    const age = now - pending.sentAt;
    if (oldest === null || age > oldest) {
      oldest = age;
    }
  }

  return {
    pendingCount: pendingAcks.size,
    oldestPendingMs: oldest,
  };
}

/**
 * 停止 QoS 处理器
 * 清理定时器和待确认消息
 */
export function stopQosHandler(): void {
  if (retryTimer) {
    clearInterval(retryTimer);
    retryTimer = null;
  }
  pendingAcks.clear();
}
