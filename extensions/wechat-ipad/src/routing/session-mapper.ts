/**
 * 会话映射管理器
 *
 * 维护 wxid ↔ sessionKey ↔ agentId 的映射关系：
 * - sessionKey 格式：wechat-ipad:{wxid}@{agentId}
 * - 用于 OpenClaw 消息管道的会话标识
 * - 支持按 wxid 查找、按 sessionKey 反查
 */

/** 会话映射项 */
interface SessionEntry {
  /** 微信用户 wxid */
  wxid: string;
  /** 关联的 Agent ID */
  agentId: string;
  /** OpenClaw 会话键 */
  sessionKey: string;
  /** 是否群会话 */
  isGroup: boolean;
  /** 创建时间 */
  createdAt: number;
  /** 最后活跃时间 */
  lastActiveAt: number;
}

/** wxid → SessionEntry 映射 */
const wxidToSession = new Map<string, SessionEntry>();

/** sessionKey → SessionEntry 映射 */
const sessionKeyToEntry = new Map<string, SessionEntry>();

/**
 * 构造 OpenClaw 会话键
 *
 * @param wxid - 微信用户/群 wxid
 * @param agentId - 目标 Agent ID
 * @returns 格式化的会话键
 */
export function buildSessionKey(wxid: string, agentId: string): string {
  return `wechat-ipad:${wxid}@${agentId}`;
}

/**
 * 从 sessionKey 解析出 wxid
 *
 * @param sessionKey - OpenClaw 会话键
 * @returns wxid，解析失败返回 null
 */
export function parseWxidFromSessionKey(sessionKey: string): string | null {
  const match = sessionKey.match(/^wechat-ipad:(.+)@(.+)$/);
  return match ? match[1] : null;
}

/**
 * 获取或创建会话映射
 * 若该 wxid 的会话已存在则更新 lastActiveAt 并返回
 * 否则创建新的会话映射
 *
 * @param wxid - 微信用户/群 wxid
 * @param agentId - 目标 Agent ID
 * @param isGroup - 是否群会话
 * @returns 会话键
 */
export function getOrCreateSession(
  wxid: string,
  agentId: string,
  isGroup: boolean
): string {
  const existing = wxidToSession.get(wxid);
  if (existing) {
    existing.lastActiveAt = Date.now();
    existing.agentId = agentId;
    return existing.sessionKey;
  }

  const sessionKey = buildSessionKey(wxid, agentId);
  const entry: SessionEntry = {
    wxid,
    agentId,
    sessionKey,
    isGroup,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  };

  wxidToSession.set(wxid, entry);
  sessionKeyToEntry.set(sessionKey, entry);

  return sessionKey;
}

/**
 * 根据 wxid 获取现有会话的 sessionKey
 *
 * @param wxid - 微信用户/群 wxid
 * @returns 会话键，不存在返回 null
 */
export function getSessionByWxid(wxid: string): string | null {
  return wxidToSession.get(wxid)?.sessionKey ?? null;
}

/**
 * 根据 sessionKey 获取 wxid
 *
 * @param sessionKey - OpenClaw 会话键
 * @returns wxid，不存在返回 null
 */
export function getWxidBySessionKey(sessionKey: string): string | null {
  return sessionKeyToEntry.get(sessionKey)?.wxid ?? null;
}

/**
 * 移除指定 wxid 的会话映射
 *
 * @param wxid - 微信用户/群 wxid
 */
export function removeSession(wxid: string): void {
  const entry = wxidToSession.get(wxid);
  if (entry) {
    sessionKeyToEntry.delete(entry.sessionKey);
    wxidToSession.delete(wxid);
  }
}

/**
 * 清空所有会话映射（用于断连/重新登录时）
 */
export function clearAllSessions(): void {
  wxidToSession.clear();
  sessionKeyToEntry.clear();
}

/**
 * 获取会话统计信息
 *
 * @returns 当前会话数量和分类统计
 */
export function getSessionStats(): {
  total: number;
  direct: number;
  group: number;
} {
  let direct = 0;
  let group = 0;
  for (const entry of wxidToSession.values()) {
    if (entry.isGroup) {
      group++;
    } else {
      direct++;
    }
  }
  return { total: wxidToSession.size, direct, group };
}

/**
 * 获取所有会话列表（状态查询用）
 *
 * @returns 会话信息数组
 */
export function listSessions(): Array<{
  wxid: string;
  agentId: string;
  sessionKey: string;
  isGroup: boolean;
  lastActiveAt: string;
}> {
  return Array.from(wxidToSession.values()).map((e) => ({
    wxid: e.wxid,
    agentId: e.agentId,
    sessionKey: e.sessionKey,
    isGroup: e.isGroup,
    lastActiveAt: new Date(e.lastActiveAt).toISOString(),
  }));
}
