/**
 * @module state-manager
 *
 * 企业微信插件进程级共享状态（WS 客户端、流式 MessageState、ReqId、会话 peer 缓存）。
 *
 * **职责**：
 * - 按 accountId 持有已认证 `WSClient` 实例（outbound / MCP 工具复用）
 * - TTL Map 管理入站 `MessageState`（流式 accumulatedText / streamId）
 * - 按 accountId 隔离 ReqIdStore（chatId → req_id，供主动发送 biz_msg 等）
 * - sessionKey → 原始 chatId/chatType 缓存（避免 OpenClaw 小写化导致 93006）
 *
 * **适用场景**：`monitor` 生命周期、`message-sender`、MCP 拦截器、outbound 通道。
 *
 * **上下游**：
 * - 上游：`@partme.ai/openclaw-message-sdk/util`（TTL Map、ReqIdStore、global singleton）
 * - 下游：各需要 WS 或 reqId 的模块
 *
 * **关键导出**：WebSocket / MessageState / ReqId / SessionChatInfo CRUD 与 `cleanupAccount`
 */

import type { WSClient } from "@wecom/aibot-node-sdk";
import {
  getGlobalSingleton,
  createTtlMapStore,
  createReqIdStore,
  type ReqIdStore,
  type TtlMapStore,
} from "@partme.ai/openclaw-message-sdk/util";
import {
  createSessionPeerCache,
  type SessionPeerInfo,
} from "@partme.ai/openclaw-message-sdk/routing";
import type { MessageState } from "../types/interface.js";
import {
  MESSAGE_STATE_TTL_MS,
  MESSAGE_STATE_CLEANUP_INTERVAL_MS,
  MESSAGE_STATE_MAX_SIZE,
  GLOBAL_WS_CLIENT_KEY,
} from "../types/const.js";

const SHARED_STATE_KEY = "wecom-openclaw-plugin:shared-state:v1";

/** 插件全局共享状态容器 */
interface SharedState {
  wsClientInstances: Map<string, WSClient>;
  messageStates: TtlMapStore<MessageState>;
  reqIdStores: Map<string, ReqIdStore>;
}

/**
 * 获取（或惰性创建）进程级共享状态单例。
 *
 * @returns WS 实例 Map、MessageState TTL Store、ReqId Store Map
 */
function getSharedState(): SharedState {
  return getGlobalSingleton(SHARED_STATE_KEY, () => {
    const messageStates = createTtlMapStore<MessageState>({
      ttlMs: MESSAGE_STATE_TTL_MS,
      maxSize: MESSAGE_STATE_MAX_SIZE,
      cleanupIntervalMs: MESSAGE_STATE_CLEANUP_INTERVAL_MS,
    });
    messageStates.startCleanup();
    return {
      wsClientInstances: new Map<string, WSClient>(),
      messageStates,
      reqIdStores: new Map<string, ReqIdStore>(),
    };
  });
}

const shared = getSharedState();

/** 兼容旧版 globalThis 键的 WS 实例 Map（逐步迁移至 shared） */
const wsClientInstances: Map<string, WSClient> = ((globalThis as Record<string, unknown>)[GLOBAL_WS_CLIENT_KEY]
  ?? ((globalThis as Record<string, unknown>)[GLOBAL_WS_CLIENT_KEY] = new Map<string, WSClient>())) as Map<string, WSClient>;

/** sessionKey → 原始 chatId/chatType（MCP biz_msg 等需要未小写化的 chatId） */
const sessionPeerCache = createSessionPeerCache();

/**
 * 获取指定账号的 WSClient 实例。
 *
 * @param accountId - 账号 ID
 * @returns 已认证客户端；未连接时 `null`
 */
export function getWeComWebSocket(accountId: string): WSClient | null {
  return shared.wsClientInstances.get(accountId) ?? null;
}

/**
 * 注册指定账号的 WSClient（authenticated 事件后调用）。
 *
 * @param accountId - 账号 ID
 * @param client - SDK WSClient 实例
 */
export function setWeComWebSocket(accountId: string, client: WSClient): void {
  shared.wsClientInstances.set(accountId, client);
}

/**
 * 移除指定账号的 WSClient 引用（不断开连接，断开由 cleanupAccount 负责）。
 *
 * @param accountId - 账号 ID
 */
export function deleteWeComWebSocket(accountId: string): void {
  shared.wsClientInstances.delete(accountId);
}

/** 启动 MessageState TTL 定期清理（monitor 启动时调用） */
export function startMessageStateCleanup(): void {
  shared.messageStates.startCleanup();
}

/** 停止 MessageState TTL 定期清理（monitor 停止时调用） */
export function stopMessageStateCleanup(): void {
  shared.messageStates.stopCleanup();
}

/**
 * 写入消息级流式状态。
 *
 * @param messageId - 企微 msgid
 * @param state - 流式状态（accumulatedText / streamId 等）
 */
export function setMessageState(messageId: string, state: MessageState): void {
  shared.messageStates.set(messageId, state);
}

/**
 * 读取消息级流式状态。
 *
 * @param messageId - 企微 msgid
 * @returns 状态或 `undefined`（已过期/不存在）
 */
export function getMessageState(messageId: string): MessageState | undefined {
  return shared.messageStates.get(messageId);
}

/**
 * 删除消息级流式状态（dispatch 结束 cleanup 时调用）。
 *
 * @param messageId - 企微 msgid
 */
export function deleteMessageState(messageId: string): void {
  shared.messageStates.delete(messageId);
}

/** 清空所有 MessageState（测试 / 全量 cleanup） */
export function clearAllMessageStates(): void {
  shared.messageStates.clear();
}

/**
 * 获取或创建账号级 ReqIdStore。
 *
 * @param accountId - 账号 ID
 * @returns 内存 ReqIdStore 实例
 */
function getOrCreateReqIdStore(accountId: string): ReqIdStore {
  let store = shared.reqIdStores.get(accountId);
  if (!store) {
    store = createReqIdStore(accountId);
    shared.reqIdStores.set(accountId, store);
  }
  return store;
}

/**
 * 记录 chatId 对应的最新 req_id（入站消息处理时写入）。
 *
 * @param chatId - 会话 ID
 * @param reqId - WS 帧 headers.req_id
 * @param accountId - 账号 ID，默认 `default`
 */
export function setReqIdForChat(chatId: string, reqId: string, accountId = "default"): void {
  getOrCreateReqIdStore(accountId).set(chatId, reqId);
}

/**
 * 异步读取 chatId 对应的 req_id。
 *
 * @param chatId - 会话 ID
 * @param accountId - 账号 ID
 * @returns req_id 或 `undefined`
 */
export async function getReqIdForChatAsync(chatId: string, accountId = "default"): Promise<string | undefined> {
  return getOrCreateReqIdStore(accountId).get(chatId);
}

/**
 * 同步读取 chatId 对应的 req_id（内存 store，无 I/O）。
 *
 * @param chatId - 会话 ID
 * @param accountId - 账号 ID
 * @returns req_id 或 `undefined`
 */
export function getReqIdForChat(chatId: string, accountId = "default"): string | undefined {
  return getOrCreateReqIdStore(accountId).getSync(chatId);
}

/**
 * 删除 chatId 的 req_id 映射。
 *
 * @param chatId - 会话 ID
 * @param accountId - 账号 ID
 */
export function deleteReqIdForChat(chatId: string, accountId = "default"): void {
  getOrCreateReqIdStore(accountId).delete(chatId);
}

/**
 * 预热 ReqIdStore（当前为 memory-only，no-op）。
 *
 * @param accountId - 账号 ID
 * @param log - 可选日志
 * @returns 预热条目数（恒为 0）
 */
export async function warmupReqIdStore(
  accountId = "default",
  log?: (...args: unknown[]) => void,
): Promise<number> {
  log?.("[WeCom] reqid-store warmup: no-op (memory-only store)");
  return 0;
}

/**
 * 刷盘 ReqIdStore（当前为 memory-only，no-op）。
 *
 * @param _accountId - 账号 ID（未使用）
 */
export async function flushReqIdStore(_accountId = "default"): Promise<void> {
  // memory-only store
}

/** 会话 chat 信息（WeCom 别名，含原始大小写 chatId） */
export type SessionChatInfo = SessionPeerInfo;

/**
 * 缓存 sessionKey 对应的原始 chatId/chatType。
 *
 * @param sessionKey - OpenClaw sessionKey
 * @param info - 原始 chatId 与 single/group 类型
 */
export function setSessionChatInfo(sessionKey: string, info: SessionChatInfo): void {
  sessionPeerCache.set(sessionKey, info);
}

/**
 * 读取 sessionKey 对应的 chat 信息。
 *
 * @param sessionKey - OpenClaw sessionKey
 * @returns chat 信息或 `undefined`
 */
export function getSessionChatInfo(sessionKey: string | undefined): SessionChatInfo | undefined {
  return sessionPeerCache.get(sessionKey);
}

/**
 * 删除 sessionKey 的 chat 缓存。
 *
 * @param sessionKey - OpenClaw sessionKey
 */
export function deleteSessionChatInfo(sessionKey: string): void {
  sessionPeerCache.delete(sessionKey);
}

/**
 * 清理指定账号资源：断开 WS 并移除实例引用。
 *
 * @param accountId - 账号 ID
 */
export async function cleanupAccount(accountId: string): Promise<void> {
  const wsClient = shared.wsClientInstances.get(accountId);
  if (wsClient) {
    try {
      wsClient.disconnect();
    } catch {
      // ignore
    }
    shared.wsClientInstances.delete(accountId);
  }
}

/** 清理所有账号 WS 连接与 MessageState（进程退出 / 测试 teardown） */
export async function cleanupAll(): Promise<void> {
  stopMessageStateCleanup();

  for (const [, wsClient] of shared.wsClientInstances) {
    try {
      wsClient.disconnect();
    } catch {
      // ignore
    }
  }
  shared.wsClientInstances.clear();
  clearAllMessageStates();
}
