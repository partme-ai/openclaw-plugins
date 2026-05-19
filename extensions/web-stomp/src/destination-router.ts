/**
 * STOMP Destination 路由模块
 * 将 STOMP Destination 映射到 OpenClaw Agent
 *
 * Destination 规范：
 * - /queue/agent                   -- 发送消息给默认 Agent
 * - /queue/agent.<agentId>         -- 发送消息给指定 Agent
 * - /topic/session.<key>           -- 订阅某会话的事件流
 * - /topic/agent.<agentId>.events  -- 订阅 Agent 级别事件
 */

/**
 * Destination 解析结果
 */
export interface DestinationRoute {
  /** 路由类型 */
  type: "queue" | "topic";
  /** 目标类别 */
  target: "agent" | "session";
  /** Agent ID（如果有） */
  agentId?: string;
  /** Session Key（如果有） */
  sessionKey?: string;
  /** 事件类型（如 "events"） */
  eventType?: string;
}

/**
 * 解析 STOMP Destination
 * 从 Destination 路径中提取路由信息
 *
 * @param destination - STOMP Destination 字符串
 * @returns 路由信息，null 表示无法解析
 */
export function parseDestination(destination: string): DestinationRoute | null {
  // /queue/agent -- 发送给默认 Agent
  if (destination === "/queue/agent") {
    return {
      type: "queue",
      target: "agent",
    };
  }

  // /queue/agent.<agentId> -- 发送给指定 Agent
  const queueAgentMatch = destination.match(/^\/queue\/agent\.(.+)$/);
  if (queueAgentMatch) {
    return {
      type: "queue",
      target: "agent",
      agentId: queueAgentMatch[1],
    };
  }

  // /topic/session.<key> -- 订阅会话事件流
  const topicSessionMatch = destination.match(/^\/topic\/session\.(.+)$/);
  if (topicSessionMatch) {
    return {
      type: "topic",
      target: "session",
      sessionKey: topicSessionMatch[1],
    };
  }

  // /topic/agent.<agentId>.events -- 订阅 Agent 事件
  const topicAgentMatch = destination.match(
    /^\/topic\/agent\.([^.]+)\.(\w+)$/
  );
  if (topicAgentMatch) {
    return {
      type: "topic",
      target: "agent",
      agentId: topicAgentMatch[1],
      eventType: topicAgentMatch[2],
    };
  }

  return null;
}

/**
 * 构建会话事件 Destination
 *
 * @param sessionKey - OpenClaw 会话键
 * @returns Topic Destination
 */
export function buildSessionDestination(sessionKey: string): string {
  return `/topic/session.${sessionKey}`;
}

/**
 * 构建 Agent 事件 Destination
 *
 * @param agentId - Agent ID
 * @param eventType - 事件类型
 * @returns Topic Destination
 */
export function buildAgentEventDestination(
  agentId: string,
  eventType = "events"
): string {
  return `/topic/agent.${agentId}.${eventType}`;
}

/**
 * 验证 Destination 是否可订阅（/topic/ 前缀）
 *
 * @param destination - 目标 Destination
 */
export function isSubscribable(destination: string): boolean {
  return destination.startsWith("/topic/");
}

/**
 * 验证 Destination 是否可发送（/queue/ 前缀）
 *
 * @param destination - 目标 Destination
 */
export function isSendable(destination: string): boolean {
  return destination.startsWith("/queue/");
}
