/**
 * @module message-sdk/transport
 *
 * MQ 渠道插件共享传输抽象 — 消除 stomp / mqtt / web-stomp / web-mqtt 的重复逻辑。
 *
 * 提供：
 * - `matchTopic` / `isTopicAllowed` — 统一 topic 通配符匹配
 * - `verifyPassword` / `safeEqualBuffer` — 统一密码校验
 * - `createChannelIdempotencyCache` — 进程内单例幂等缓存工厂
 * - `resolvePayloadMode` — Wire payload 模式映射
 * - `isUserActionAllowed` / `AclRule` / `AclUser` — 统一 ACL 评估引擎
 * - `createTransportMetrics` — 统一 Prometheus 指标工厂
 */

export {
  matchTopic,
  isTopicAllowed,
  isValidMqttTopicName,
  isValidMqttTopicFilter,
} from "./topic-matcher.js";

export {
  verifyPassword,
  safeEqualBuffer,
} from "./auth-guard.js";

export {
  createChannelIdempotencyCache,
} from "./idempotency-factory.js";

export {
  resolvePayloadMode,
} from "./payload-resolver.js";

export {
  isUserActionAllowed,
  type AclRule,
  type AclUser,
  type AclAction,
} from "./acl-engine.js";

// Metrics 需要安装 prom-client，按需导入：
//   import { createTransportMetrics } from "@partme.ai/openclaw-message-sdk/transport/metrics";
// 不在此处自动导出，避免未安装 prom-client 时影响其他消费者。
