/**
 * MQTT Topic 路由模块
 * 将 MQTT Topic 映射到 OpenClaw Agent，并支持显式 topic 绑定
 *
 * Topic 规范：
 * - openclaw/agent/<agentId>/in     -- 设备发送消息给指定 Agent
 * - openclaw/agent/<agentId>/out    -- Agent 回复发布到此 Topic
 * - openclaw/agent/<agentId>/status -- Agent 状态变更通知
 * - openclaw/system/health          -- 系统健康状态
 */

import type { MqttInboundRoute, MqttTopicMapping } from "./types.js";

/** Agent 入站消息 Topic 前缀 */
const AGENT_INBOUND_PREFIX = "openclaw/agent/";
const AGENT_INBOUND_SUFFIX = "/in";

/** 归一化后的映射规则 */
interface NormalizedTopicMapping {
  topicPattern: string;
  agentId: string;
  accountId: string;
  replyTopic?: string;
  scope: string;
}

/** 自定义 Topic 映射规则（显式绑定优先） */
const customMappings: NormalizedTopicMapping[] = [];

/**
 * 解析 Topic 结构
 * 从标准 Topic 格式中提取 Agent ID 和消息方向
 *
 * @param topic - MQTT Topic 字符串
 * @returns 解析结果，null 表示非法 Topic
 */
export function parseTopic(topic: string): {
  agentId: string;
  direction: "in" | "out" | "status";
} | null {
  // 标准格式：openclaw/agent/<agentId>/<direction>
  if (!topic.startsWith(AGENT_INBOUND_PREFIX)) {
    return null;
  }

  const rest = topic.slice(AGENT_INBOUND_PREFIX.length);
  const slashIdx = rest.indexOf("/");

  if (slashIdx === -1) return null;

  const agentId = rest.slice(0, slashIdx);
  const direction = rest.slice(slashIdx + 1);

  if (direction === "in" || direction === "out" || direction === "status") {
    return { agentId, direction };
  }

  return null;
}

/**
 * 根据 Topic 获取目标路由（显式绑定优先，标准格式回退）
 *
 * @param topic - 入站消息的 Topic
 * @returns 路由结果，null 表示无匹配
 */
export function resolveInboundRoute(topic: string): MqttInboundRoute | null {
  for (const mapping of customMappings) {
    if (matchTopic(topic, mapping.topicPattern)) {
      return {
        agentId: mapping.agentId,
        accountId: mapping.accountId,
        replyTopic: mapping.replyTopic,
        matchedPattern: mapping.topicPattern,
        source: "binding",
      };
    }
  }

  if (
    topic.startsWith(AGENT_INBOUND_PREFIX) &&
    topic.endsWith(AGENT_INBOUND_SUFFIX)
  ) {
    const agentId = topic.slice(
      AGENT_INBOUND_PREFIX.length,
      topic.length - AGENT_INBOUND_SUFFIX.length
    );
    if (agentId) {
      return {
        agentId,
        accountId: "default",
        replyTopic: buildReplyTopicFromInbound(topic),
        matchedPattern: "openclaw/agent/<agentId>/in",
        source: "standard",
      };
    }
  }

  return null;
}

/**
 * 兼容旧接口：仅返回 Agent ID
 *
 * @param topic - 入站消息的 Topic
 * @returns Agent ID，null 表示无匹配
 */
export function resolveAgentId(topic: string): string | null {
  return resolveInboundRoute(topic)?.agentId ?? null;
}

/**
 * 从入站 Topic 推导默认回复 Topic
 *
 * @param inboundTopic - 入站 Topic
 * @returns 推导出的回复 Topic
 */
export function buildReplyTopicFromInbound(inboundTopic: string): string {
  if (inboundTopic.endsWith("/in")) {
    return inboundTopic.slice(0, -3) + "/out";
  }
  return inboundTopic + "/out";
}

/**
 * 构建 Agent 默认出站 Topic
 *
 * @param agentId - Agent ID
 */
export function buildOutboundTopic(agentId: string): string {
  return `openclaw/agent/${agentId}/out`;
}

/**
 * 构建 Agent 状态 Topic
 *
 * @param agentId - Agent ID
 */
export function buildStatusTopic(agentId: string): string {
  return `openclaw/agent/${agentId}/status`;
}

/**
 * 加载显式 Topic 映射规则
 * 从 OpenClaw 配置中读取
 *
 * @param mappings - 映射规则列表
 */
export function loadTopicMappings(mappings: MqttTopicMapping[]): void {
  const normalized = mappings.map((mapping) => ({
    topicPattern: mapping.topicPattern,
    agentId: mapping.agentId,
    accountId: mapping.accountId ?? "default",
    replyTopic: mapping.replyTopic,
    scope: mapping.scope ?? "default",
  }));

  customMappings.length = 0;
  customMappings.push(...normalized);
  console.log(`[openclaw-mqtt] Loaded ${normalized.length} topic bindings`);
}

/**
 * 获取当前已加载的 Topic 映射规则（只读）
 */
export function getLoadedTopicMappings(): ReadonlyArray<NormalizedTopicMapping> {
  return customMappings;
}

/**
 * MQTT Topic 通配符匹配
 * 支持 + (单级) 和 # (多级) 通配符
 *
 * @param topic - 实际 Topic
 * @param pattern - 匹配模式
 */
export function matchTopic(topic: string, pattern: string): boolean {
  const topicParts = topic.split("/");
  const patternParts = pattern.split("/");

  for (let i = 0; i < patternParts.length; i++) {
    const pp = patternParts[i];

    // # 匹配剩余所有级别
    if (pp === "#") return true;

    // + 匹配单个级别
    if (pp === "+") {
      if (i >= topicParts.length) return false;
      continue;
    }

    // 精确匹配
    if (i >= topicParts.length || pp !== topicParts[i]) {
      return false;
    }
  }

  return topicParts.length === patternParts.length;
}
