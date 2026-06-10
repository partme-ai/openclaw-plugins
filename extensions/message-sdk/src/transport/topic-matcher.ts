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

    // `#` 匹配剩余所有层级
    if (p === "#") return true;

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
