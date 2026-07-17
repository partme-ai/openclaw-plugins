/**
 * Router 规则匹配器。
 *
 * `*` 和 `?` 只具有 glob 语义，其余正则元字符会先转义；最终表达式使用全字符串
 * 匹配，避免渠道名或 topic 的局部命中造成意外转发。
 */
import type { RouteDirection, RouterRule } from "./types.js";

function globMatch(pattern: string, value: string | undefined): boolean {
  if (value === undefined) return false;
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const expression = escaped.replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${expression}$`).test(value);
}

/**
 * 判断渠道事件是否满足一条路由规则。
 *
 * channels/topic/accountId 支持受控 glob，direction 支持双向；缺省字段表示不限制，所有已配置
 * 条件必须同时命中，避免宽泛规则因局部字符串匹配而意外转发。
 */
export function matchRule(
  rule: RouterRule,
  channelId: string,
  direction: RouteDirection,
  topic?: string,
  accountId?: string,
): boolean {
  const match = rule.match;
  if (match.channels?.length && !match.channels.some((pattern) => globMatch(pattern, channelId))) return false;
  if (match.direction && match.direction !== "both" && match.direction !== direction) return false;
  if (match.topic && !globMatch(match.topic, topic)) return false;
  if (match.accountId && !globMatch(match.accountId, accountId)) return false;
  return true;
}
