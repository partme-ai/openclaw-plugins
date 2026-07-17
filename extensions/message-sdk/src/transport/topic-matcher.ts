/**
 * @module message-sdk/transport/topic-matcher
 *
 * 统一 Topic 通配符匹配 — 同时支持 MQTT 风格（`+`/`#`）与 STOMP 风格（`*`/`#`）。
 *
 * 各 MQ 渠道插件（mqtt / web-mqtt / stomp / web-stomp）的 topic 匹配逻辑
 * 最终收敛到此模块，消除四处各自实现的重复代码。
 */

/**
 * 将 topic 和 pattern 按 `/` 分割后做通配符匹配。
 *
 * 支持的通配符：
 * - `+` 或 `*` — 匹配单个层级
 * - `#` — 匹配剩余所有层级（必须出现在 pattern 末尾才有效）
 *
 * @param topic - 实际 topic 字符串
 * @param pattern - 含通配符的 pattern
 * @returns 是否匹配
 */
export function matchTopic(topic: string, pattern: string): boolean {
  const tp = topic.split("/");
  const pp = pattern.split("/");

  for (let i = 0; i < pp.length; i++) {
    const p = pp[i];
    const t = tp[i];

    // `#` 只有作为最后一个完整层级时才合法；中间出现必须 fail-closed，
    // 否则 `a/#/admin` 会意外放行 `a/任意内容`，扩大 ACL 授权范围。
    if (p === "#") return i === pp.length - 1;

    // `+` (MQTT) 或 `*` (STOMP) — 匹配单个层级
    if (p === "+" || p === "*") {
      if (t === undefined) return false;
      continue;
    }

    // 精确匹配
    if (p !== t) return false;
  }

  return tp.length === pp.length;
}

/**
 * 判断 topic 是否落在白名单 pattern 列表中（空列表表示全放行）。
 *
 * @param topic - 待检查的 topic
 * @param patterns - 通配符 pattern 列表
 * @returns 是否在白名单中
 */
export function isTopicAllowed(topic: string, patterns: string[]): boolean {
  if (patterns.length === 0) return true;
  return patterns.some((pattern) => matchTopic(topic, pattern));
}

/** MQTT Topic Name/Filter 的协议最大 UTF-8 字节数。 */
const MQTT_TOPIC_MAX_BYTES = 65_535;

/**
 * 校验可用于 PUBLISH 的 MQTT Topic Name。
 *
 * Topic Name 必须非空、不能包含 NUL，也不能包含订阅通配符 `+` / `#`。
 */
export function isValidMqttTopicName(topic: string): boolean {
  return Boolean(
    topic &&
      !topic.includes("\0") &&
      !topic.includes("+") &&
      !topic.includes("#") &&
      Buffer.byteLength(topic, "utf8") <= MQTT_TOPIC_MAX_BYTES,
  );
}

/**
 * 校验 MQTT Topic Filter。
 *
 * `+` 必须占据完整层级；`#` 必须占据最后一个完整层级。该校验用于在启动前
 * 拒绝会扩大或破坏 ACL 语义的错误配置，而不是等到客户端请求时再猜测意图。
 */
export function isValidMqttTopicFilter(filter: string): boolean {
  // 共享 matcher 还兼容 STOMP 的 `*` 通配符；MQTT 配置若接受字面量 `*`，
  // 后续匹配时会被误解为通配授权，因此在 MQTT 边界明确拒绝它。
  if (
    !filter ||
    filter.includes("\0") ||
    filter.includes("*") ||
    Buffer.byteLength(filter, "utf8") > MQTT_TOPIC_MAX_BYTES
  ) {
    return false;
  }
  const levels = filter.split("/");
  return levels.every((level, index) => {
    if (level.includes("#")) return level === "#" && index === levels.length - 1;
    if (level.includes("+")) return level === "+";
    return true;
  });
}
