/**
 * @module routing/session-peer-cache
 *
 * sessionKey → 原始 peer 信息缓存 / Cache mapping OpenClaw sessionKey to peer metadata.
 *
 * **职责**：缓存 sessionKey 对应的原始 chatId（保留大小写）与 chatType，避免 OpenClaw
 * sessionKey 规范化后反解丢失信息。
 *
 * **适用场景**：出站回复需还原平台原始 chatId；多 loader 下通过 `getGlobalSingleton` 共享。
 *
 * **上下游**：
 * - 上游：ingress 路由写入、dispatch 出站读取
 * - 下游：无
 *
 * **关键导出**：`createSessionPeerCache`、`SessionPeerCache`、`SessionPeerInfo`
 */

/** 会话 peer 信息 / Cached peer metadata for a session */
export interface SessionPeerInfo {
  /** 原始大小写的 chatId（群 ID 或用户 ID）/ Original-case chat or user id */
  chatId: string;
  /** 聊天类型 / Conversation type */
  chatType: "single" | "group";
}

/** 会话 peer 缓存接口 / Session peer cache API */
export interface SessionPeerCache {
  /** 写入 sessionKey → peer 映射 / Set mapping */
  set(sessionKey: string, info: SessionPeerInfo): void;
  /** 读取；空 sessionKey 返回 undefined / Get by session key */
  get(sessionKey: string | undefined): SessionPeerInfo | undefined;
  /** 删除指定 sessionKey / Delete entry */
  delete(sessionKey: string): void;
}

const DEFAULT_MAX_SIZE = 5000;

/**
 * 创建 sessionKey → SessionPeerInfo 的 LRU 风格缓存。
 *
 * 容量满且写入新键时，淘汰 Map 迭代顺序中最旧条目（近似 LRU）。
 * 空 `sessionKey` 的 set/get 为 no-op / undefined。
 *
 * @param maxSize - 最大缓存条目数，默认 5000 / Max entries
 * @returns 会话 peer 缓存实例 / Cache instance
 *
 * @example
 * ```ts
 * const cache = createSessionPeerCache();
 * cache.set(route.sessionKey, { chatId: rawChatId, chatType: "group" });
 * ```
 */
export function createSessionPeerCache(maxSize = DEFAULT_MAX_SIZE): SessionPeerCache {
  const cache = new Map<string, SessionPeerInfo>();

  return {
    set(sessionKey, info) {
      if (!sessionKey) {
        return;
      }
      // 容量满：淘汰最旧键（Map 插入顺序）
      if (cache.size >= maxSize && !cache.has(sessionKey)) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey !== undefined) {
          cache.delete(oldestKey);
        }
      }
      cache.set(sessionKey, info);
    },
    get(sessionKey) {
      if (!sessionKey) {
        return undefined;
      }
      return cache.get(sessionKey);
    },
    delete(sessionKey) {
      cache.delete(sessionKey);
    },
  };
}
