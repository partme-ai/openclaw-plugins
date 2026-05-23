/**
 * RabbitMQ Topic 路由模块
 * 将 RabbitMQ Topic 映射到 OpenClaw Agent，并支持显式 topic 绑定
 *
 * Topic 规范：
 * - {topicPrefix}.agent.<agentId>.in          -- 设备发送消息给指定 Agent
 * - {topicPrefix}.agent.<agentId>.out         -- Agent 回复发布到此 Topic
 * - {topicPrefix}.agent.<agentId>.status      -- Agent 状态变更通知
 */

import type { RabbitmqInboundRoute } from "../types.js";
import type { RabbitmqConfig, TopicBinding } from "../config.js";

/**
 * Agent 入站消息 Topic 前缀
 */
const AGENT_INBOUND_SUFFIX = ".in";

/**
 * 解析 Topic 结构
 * 从标准 Topic 格式中提取 Agent ID 和 Peer ID
 *
 * @param topic - RabbitMQ Topic 字符串
 * @param topicPrefix - Topic 前缀
 * @returns 解析结果，null 表示非法 Topic
 */
export function parseTopic(topic: string, topicPrefix: string): {
  agentId: string;
  peerId: string;
  direction: "in" | "out" | "status";
} | null {
  const prefix = topicPrefix ? `${topicPrefix}.` : "";
  
  if (!topic.startsWith(prefix)) {
    return null;
  }

  const rest = topic.slice(prefix.length);
  const parts = rest.split(".");

  if (parts.length < 3) {
    return null;
  }

  if (parts[0] !== "agent") {
    return null;
  }

  const agentId = parts[1];
  const direction = parts[2] as "in" | "out" | "status";
  const peerId = parts.length > 3 ? parts.slice(3).join(".") : "";

  if (direction === "in" || direction === "out" || direction === "status") {
    return { agentId, direction, peerId };
  }

  return null;
}

/**
 * 根据 Topic 获取目标路由（显式绑定优先，标准格式回退）
 *
 * @param topic - 入站消息的 Topic
 * @param config - RabbitMQ 配置
 * @returns 路由结果，null 表示无匹配
 */
export function resolveInboundRoute(topic: string, config: RabbitmqConfig): RabbitmqInboundRoute | null {
  // First: check explicit topicBindings
  for (const binding of config.topicBindings) {
    if (matchTopic(topic, binding.topicPattern)) {
      const peerId = extractPeerIdFromTopic(topic, binding.topicPattern);
      return {
        agentId: binding.agentId,
        accountId: binding.accountId,
        replyTopic: binding.replyTopicPattern 
          ? replaceTopicPattern(binding.replyTopicPattern, topic)
          : buildReplyTopicFromInbound(topic, config.topicPrefix),
        matchedPattern: binding.topicPattern,
        source: "binding",
        peerId,
      };
    }
  }

  // Second: check standard format {topicPrefix}.agent.<agentId>.in
  const parsed = parseTopic(topic, config.topicPrefix);
  if (parsed && parsed.direction === "in") {
    return {
      agentId: parsed.agentId,
      accountId: "default",
      replyTopic: buildReplyTopicFromInbound(topic, config.topicPrefix),
      matchedPattern: `${config.topicPrefix}.agent.<agentId>.in`,
      source: "standard",
      peerId: parsed.peerId,
    };
  }

  return null;
}

/**
 * 从入站 Topic 推导默认回复 Topic
 *
 * @param inboundTopic - 入站 Topic
 * @param topicPrefix - Topic 前缀
 * @returns 推导出的回复 Topic
 */
export function buildReplyTopicFromInbound(inboundTopic: string, topicPrefix: string): string {
  if (inboundTopic.endsWith(".in")) {
    return inboundTopic.slice(0, -3) + ".out";
  }
  return inboundTopic + ".out";
}

/**
 * 构建 Agent 默认出站 Topic
 *
 * @param agentId - Agent ID
 * @param topicPrefix - Topic 前缀
 * @param peerId - Peer ID (optional)
 */
export function buildOutboundTopic(agentId: string, topicPrefix: string, peerId?: string): string {
  const prefix = topicPrefix ? `${topicPrefix}.` : "";
  if (peerId) {
    return `${prefix}agent.${agentId}.out.${peerId}`;
  }
  return `${prefix}agent.${agentId}.out`;
}

/**
 * 从 Topic 中提取 Peer ID
 *
 * @param topic - 实际 Topic
 * @param pattern - 匹配模式
 */
function extractPeerIdFromTopic(topic: string, pattern: string): string {
  const topicParts = normalizeTopic(topic).split(".");
  const patternParts = normalizeTopic(pattern).split(".");
  const peerIdParts: string[] = [];

  for (let i = 0; i < patternParts.length; i++) {
    const pp = patternParts[i];

    if (pp === "#") {
      break;
    }

    if (pp === "*" || pp === "+") {
      if (i < topicParts.length) {
        peerIdParts.push(topicParts[i]);
      }
      continue;
    }

    if (i < topicParts.length && pp !== topicParts[i]) {
      return "";
    }
  }

  if (patternParts.length < topicParts.length) {
    peerIdParts.push(...topicParts.slice(patternParts.length));
  }

  return peerIdParts.join(".");
}

/**
 * 替换 Topic Pattern 中的变量
 *
 * @param pattern - 包含变量的 Pattern
 * @param actualTopic - 实际 Topic
 */
function replaceTopicPattern(pattern: string, actualTopic: string): string {
  const topicParts = normalizeTopic(actualTopic).split(".");
  const patternParts = normalizeTopic(pattern).split(".");
  const resultParts: string[] = [];

  for (let i = 0; i < patternParts.length; i++) {
    const pp = patternParts[i];

    if (pp.startsWith("${") && pp.endsWith("}")) {
      const varName = pp.slice(2, -1);
      if (varName === "agentId" && i < topicParts.length) {
        resultParts.push(topicParts[i]);
      } else if (varName === "peerId" && i < topicParts.length) {
        resultParts.push(topicParts[i]);
      } else if (varName === "rest" && i < topicParts.length) {
        resultParts.push(...topicParts.slice(i));
        break;
      } else {
        resultParts.push(pp);
      }
    } else if (pp === "#") {
      resultParts.push(...topicParts.slice(i));
      break;
    } else if (pp === "*" || pp === "+") {
      if (i < topicParts.length) {
        resultParts.push(topicParts[i]);
      }
    } else {
      resultParts.push(pp);
    }
  }

  return resultParts.join(".");
}

/**
 * RabbitMQ Topic 通配符匹配
 * 支持 * (单级) 和 # (多级) 通配符
 *
 * @param topic - 实际 Topic
 * @param pattern - 匹配模式
 */
export function matchTopic(topic: string, pattern: string): boolean {
  const topicParts = normalizeTopic(topic).split(".");
  const patternParts = normalizeTopic(pattern).split(".");

  let topicIndex = 0;
  let patternIndex = 0;

  while (patternIndex < patternParts.length) {
    const pp = patternParts[patternIndex];

    if (pp === "#") {
      return true;
    }

    if (topicIndex >= topicParts.length) {
      return false;
    }

    if (pp === "*" || pp === "+") {
      topicIndex++;
      patternIndex++;
      continue;
    }

    if (pp !== topicParts[topicIndex]) {
      return false;
    }

    topicIndex++;
    patternIndex++;
  }

  return topicIndex === topicParts.length;
}

function normalizeTopic(topic: string): string {
  return topic.replaceAll("/", ".");
}
