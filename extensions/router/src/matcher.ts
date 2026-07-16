import type { RouteDirection, RouterRule } from "./types.js";

function globMatch(pattern: string, value: string | undefined): boolean {
  if (value === undefined) return false;
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const expression = escaped.replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${expression}$`).test(value);
}

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

