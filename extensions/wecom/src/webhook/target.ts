/**
 * @module webhook/target
 *
 * Webhook Target **注册表**（按 HTTP 路径索引）。
 *
 * **职责**：维护 `Map<path, WecomWebhookTarget[]>`，供 handler 签名匹配与路由。
 *
 * **与 message-sdk 关系**：Target 本身无 SDK 依赖；handler 解密后进入 SDK 队列（state）。
 *
 * **关键导出**：`registerWecomWebhookTarget`、`getWebhookTargetsMap`、
 * `parseWebhookPath`、`hasActiveTargets`
 */

import type { WecomWebhookTarget } from "./types.js";

// ============================================================================
// 全局 Target 注册表（按路径索引）
// ============================================================================

/** 已注册的 Webhook Target（按路径索引） */
const webhookTargets = new Map<string, WecomWebhookTarget[]>();

// ============================================================================
// 路径工具函数
// ============================================================================

/**
 * 标准化 Webhook 路径
 *
 * 统一格式：以 `/` 开头且不以 `/` 结尾。
 */
function normalizeWebhookPath(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "/";
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  if (withSlash.length > 1 && withSlash.endsWith("/")) return withSlash.slice(0, -1);
  return withSlash;
}

/**
 * 去除重复路径
 */
function uniquePaths(paths: string[]): string[] {
  return Array.from(new Set(paths.map((p) => normalizeWebhookPath(p)).filter(Boolean)));
}

// ============================================================================
// 注册 / 注销
// ============================================================================

/**
 * 注册 Webhook Target（单条路径）
 *
 * 将 Target 加入指定路径的列表中，返回注销函数。
 */
function registerTargetForPath(path: string, target: WecomWebhookTarget): () => void {
  const key = normalizeWebhookPath(path);
  const normalizedTarget = { ...target, path: key };
  const existing = webhookTargets.get(key) ?? [];
  webhookTargets.set(key, [...existing, normalizedTarget]);

  return () => {
    const updated = (webhookTargets.get(key) ?? []).filter((entry) => entry !== normalizedTarget);
    if (updated.length > 0) webhookTargets.set(key, updated);
    else webhookTargets.delete(key);
  };
}

/**
 * 注册 Webhook Target（多条路径），返回一次性注销函数。
 *
 * @param target - Target 上下文
 * @param paths - 要注册的 HTTP 路径列表
 * @returns 注销所有路径上该 Target 的函数
 */
export function registerWecomWebhookTarget(
  target: WecomWebhookTarget,
  paths: string[],
): () => void {
  const unregisters: Array<() => void> = [];

  for (const path of uniquePaths(paths)) {
    unregisters.push(registerTargetForPath(path, target));
  }

  return () => {
    for (const unregister of unregisters) {
      unregister();
    }
  };
}

/**
 * 获取全局 Target 注册表（只读）。
 *
 * @returns 路径 → Target 列表映射
 */
export function getWebhookTargetsMap(): ReadonlyMap<string, WecomWebhookTarget[]> {
  return webhookTargets;
}

/**
 * 获取所有已注册 Target 的扁平去重列表（签名兜底遍历用）。
 *
 * @returns Target 数组
 */
export function getRegisteredTargets(): WecomWebhookTarget[] {
  const seen = new Set<WecomWebhookTarget>();
  const result: WecomWebhookTarget[] = [];
  for (const list of webhookTargets.values()) {
    for (const target of list) {
      if (!seen.has(target)) {
        seen.add(target);
        result.push(target);
      }
    }
  }
  return result;
}

/**
 * 判断是否有至少一个活跃 Target。
 *
 * @returns 有注册 Target 时为 true
 */
export function hasActiveTargets(): boolean {
  return webhookTargets.size > 0;
}

/**
 * 从 URL 路径解析 accountId（多账号 matrix 模式）。
 *
 * @param url - 完整请求 URL（含 path）
 * @returns 解析到的 accountId；无则 undefined
 */
export function parseWebhookPath(url: string): string | undefined {
  const patterns = [
    /\/plugins\/wecom\/bot\/([^/?]+)/,
    /\/wecom\/bot\/([^/?]+)/,
    /\/wecom\/([^/?]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match?.[1]) {
      const segment = match[1];
      // 排除已知的非 accountId 路径段
      if (segment === "bot") continue;
      return segment;
    }
  }
  return undefined;
}
