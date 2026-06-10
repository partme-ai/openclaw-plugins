/**
 * STOMP 订阅管理模块
 * 管理客户端的 Topic 订阅，处理消息分发
 *
 * 每个 WebSocket 连接可以有多个订阅，每个订阅关联一个 Destination。
 * 当 Agent 产生事件时，根据订阅关系将消息推送给对应的 WebSocket 连接。
 */

import type { StompSubscription } from "../types.js";

/** 所有活跃的订阅：subscriptionKey -> StompSubscription */
const subscriptions = new Map<string, StompSubscription>();

/** Destination -> 订阅 key 列表（用于快速查找某个 destination 的所有订阅者） */
const destinationIndex = new Map<string, Set<string>>();

/** 连接 -> 订阅 key 列表（用于连接断开时清理） */
const connectionIndex = new Map<string, Set<string>>();

/**
 * 添加订阅
 *
 * @param connectionId - WebSocket 连接 ID
 * @param subscription - 订阅信息
 */
export function addSubscription(
  connectionId: string,
  subscription: Omit<StompSubscription, "connectionId">
): void {
  const key = buildSubscriptionKey(connectionId, subscription.id);

  const fullSub: StompSubscription = {
    ...subscription,
    connectionId,
  };

  subscriptions.set(key, fullSub);

  // 更新 destination 索引
  if (!destinationIndex.has(subscription.destination)) {
    destinationIndex.set(subscription.destination, new Set());
  }
  destinationIndex.get(subscription.destination)!.add(key);

  // 更新 connection 索引
  if (!connectionIndex.has(connectionId)) {
    connectionIndex.set(connectionId, new Set());
  }
  connectionIndex.get(connectionId)!.add(key);

  console.log(
    `[openclaw-web-stomp] Subscription added: ${key} -> ${subscription.destination}`
  );
}

/**
 * 移除订阅
 *
 * @param connectionId - WebSocket 连接 ID
 * @param subscriptionId - 客户端指定的订阅 ID
 */
export function removeSubscription(
  connectionId: string,
  subscriptionId: string
): void {
  const key = buildSubscriptionKey(connectionId, subscriptionId);
  const sub = subscriptions.get(key);

  if (!sub) return;

  // 清理 destination 索引
  const destSubs = destinationIndex.get(sub.destination);
  if (destSubs) {
    destSubs.delete(key);
    if (destSubs.size === 0) {
      destinationIndex.delete(sub.destination);
    }
  }

  // 清理 connection 索引
  const connSubs = connectionIndex.get(connectionId);
  if (connSubs) {
    connSubs.delete(key);
    if (connSubs.size === 0) {
      connectionIndex.delete(connectionId);
    }
  }

  subscriptions.delete(key);
  console.log(`[openclaw-web-stomp] Subscription removed: ${key}`);
}

/**
 * 移除连接的所有订阅
 * 在 WebSocket 断开连接时调用
 *
 * @param connectionId - WebSocket 连接 ID
 */
export function removeAllSubscriptions(connectionId: string): void {
  const connSubs = connectionIndex.get(connectionId);
  if (!connSubs) return;

  for (const key of connSubs) {
    const sub = subscriptions.get(key);
    if (sub) {
      // 清理 destination 索引
      const destSubs = destinationIndex.get(sub.destination);
      if (destSubs) {
        destSubs.delete(key);
        if (destSubs.size === 0) {
          destinationIndex.delete(sub.destination);
        }
      }
      subscriptions.delete(key);
    }
  }

  connectionIndex.delete(connectionId);
  console.log(
    `[openclaw-web-stomp] All subscriptions removed for connection: ${connectionId}`
  );
}

/**
 * 获取指定 Destination 的所有订阅者
 * 用于消息分发
 *
 * @param destination - 目标 Destination
 * @returns 订阅者列表
 */
export function getSubscribers(
  destination: string
): StompSubscription[] {
  const keys = destinationIndex.get(destination);
  if (!keys) return [];

  const result: StompSubscription[] = [];
  for (const key of keys) {
    const sub = subscriptions.get(key);
    if (sub) result.push(sub);
  }
  return result;
}

/**
 * 获取指定连接的所有订阅
 *
 * @param connectionId - WebSocket 连接 ID
 * @returns 订阅列表
 */
export function getConnectionSubscriptions(
  connectionId: string
): StompSubscription[] {
  const keys = connectionIndex.get(connectionId);
  if (!keys) return [];

  const result: StompSubscription[] = [];
  for (const key of keys) {
    const sub = subscriptions.get(key);
    if (sub) result.push(sub);
  }
  return result;
}

/**
 * 获取订阅统计
 */
export function getSubscriptionStats(): {
  totalSubscriptions: number;
  uniqueDestinations: number;
  activeConnections: number;
} {
  return {
    totalSubscriptions: subscriptions.size,
    uniqueDestinations: destinationIndex.size,
    activeConnections: connectionIndex.size,
  };
}

/**
 * 构建订阅键
 */
function buildSubscriptionKey(
  connectionId: string,
  subscriptionId: string
): string {
  return `${connectionId}:${subscriptionId}`;
}
