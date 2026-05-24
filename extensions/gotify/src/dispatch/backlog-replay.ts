/**
 * @file Gotify backlog replay — 停机回补派发编排模块。
 *
 * @description Gateway WebSocket 启动前若配置了单一允许的 Application，
 * 按分页从历史 REST `/application/:id/message` 拉回离线期间的未完成消息，
 * 并按严格递增的消息 ID 顺序逐条调用 `dispatch`。派发成功后即刻写入 backlog cursor，
 * 以避免网关 Crash-loop、短时不可用后出现静默遗漏。**不涉及 Agent**，
 * 仅复用与 `/stream` 相同的派发钩子以保持语义对齐 Channel Plugin。
 */

import type { GotifyPagedMessages, GotifyStreamEnvelope, ResolvedGotifyAccount } from "../types.js";
import { GotifyConfigError } from "../shared/errors.js";
import { getApplicationMessages } from "../transport/gotify-api.js";
import { readBacklogCursor, writeBacklogCursor } from "./backlog-cursor.js";

/**
 * `replayBacklogForAccount()` 的可注入协作边界集合，
 * 便于单测替换分页、`dispatch`、`cursor` 持久化的读写语义而无外部磁盘和网络调用。
 */
type ReplayParams = {
  account: ResolvedGotifyAccount;
  dispatch: (message: GotifyStreamEnvelope) => Promise<void>;
  loadCursor?: (accountId: string, allowedAppId: number) => Promise<number>;
  saveCursor?: (
    accountId: string,
    allowedAppId: number,
    lastSeenMessageId: number,
  ) => Promise<void>;
  fetchPage?: (
    account: ResolvedGotifyAccount,
    applicationId: number,
    params?: { limit?: number; since?: number },
  ) => Promise<GotifyPagedMessages>;
  pageLimit?: number;
};

/**
 * 将 Gotify 侧 `id` 规范为有限正整数，避免污染 backlog cursor 与分页尾迹判断。
 *
 * @description 可接受 number / string，parse 失败或非正数时返回 0；**不抛异常**，
 * 调用方据此跳过无效记录或终止分页前移。
 * @param id - Gotify 消息 `id`（number / string / undefined）。
 * @returns 解析后的正整数 ID；失败返回 0。
 */
function parsePositiveMessageId(id: number | string | undefined): number {
  const normalized =
    typeof id === "number" ? Math.trunc(id) : Number.parseInt(String(id ?? ""), 10);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : 0;
}

/**
 * @description 启动阶段按 Application 逐页扫描 `since` / `limit` 分页窗口，
 * 抓取 **大于** 磁盘 backlog cursor 的历史消息，
 * **排序升序后串行派发**，每条派发成功后刷新 cursor，
 * 最终返回派发计数与最终 cursor snapshot。
 *
 * ### 分页策略简述
 * - out-loop：`since` 从 0 开始跳到当前页 **最旧** id，
 *   直至拿到一页不存在「仍有更大 cursor pending」的消息为止；
 * - pending buffer：收集页内任何 `messageId > cursor`，排序后再派发，
 *   **严禁批量并行塞进 Agent**，以保证 transcript / replay idempotency 对齐 `/stream`。
 *
 * @param params - replay 上下文含账号、`dispatch` 钩子及可选协作替换。
 * @returns `{ replayed, lastSeenMessageId }` —— **派发成功条数**（而非分页扫描命中总量）
 *   与最终持久化 cursor。
 * @throws GotifyConfigError —— `allowedAppId` 缺失或不合法（replay 语义前置约束）。
 */
export async function replayBacklogForAccount(
  params: ReplayParams,
): Promise<{ replayed: number; lastSeenMessageId: number }> {
  const allowedAppId = params.account.inbound.allowedAppId;
  if (!allowedAppId) {
    throw new GotifyConfigError(
      "inbound.allowedAppId",
      "backlog replay requires inbound.allowedAppId",
    );
  }

  const loadCursor = params.loadCursor ?? readBacklogCursor;
  const saveCursor = params.saveCursor ?? writeBacklogCursor;
  const fetchPage = params.fetchPage ?? getApplicationMessages;
  const pageLimit = params.pageLimit ?? 100;

  let cursor = await loadCursor(params.account.accountId, allowedAppId);
  let replayed = 0;
  const pending: GotifyStreamEnvelope[] = [];
  let since = 0;

  /*
   * Phase A — Backfill Scan：
   * 分页向后追溯直到某一页不存在「仍有更大 cursor pending tail」，
   * 把所有候选放入 pending buffer。
   */
  while (true) {
    const page = await fetchPage(params.account, allowedAppId, {
      limit: pageLimit,
      since,
    });
    const messages = [...(page.messages ?? [])] as GotifyStreamEnvelope[];
    if (messages.length === 0) {
      break;
    }

    for (const message of messages) {
      const messageId = parsePositiveMessageId(message.id);
      if (messageId > cursor) {
        pending.push(message);
      }
    }

    const oldestInPage = parsePositiveMessageId(messages[messages.length - 1]?.id);
    if (!oldestInPage || oldestInPage <= cursor) {
      break;
    }
    since = oldestInPage;
  }

  /*
   * Phase B — Ordered Drain：
   * pending 排序后线性派发；每条成功后刷新 cursor，
   * 即便中途异常也可依赖上层 gateway listener restart + WS backlog guard。
   */
  pending.sort(
    (a, b) => parsePositiveMessageId(a.id) - parsePositiveMessageId(b.id),
  );

  for (const message of pending) {
    await params.dispatch(message);
    const messageId = parsePositiveMessageId(message.id);
    if (messageId > cursor) {
      cursor = messageId;
      await saveCursor(params.account.accountId, allowedAppId, cursor);
    }
    replayed += 1;
  }

  return { replayed, lastSeenMessageId: cursor };
}
