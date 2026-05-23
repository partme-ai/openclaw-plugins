import type { GotifyPagedMessages, GotifyStreamEnvelope, ResolvedGotifyAccount } from "../types.js";
import { GotifyConfigError } from "../shared/errors.js";
import { getApplicationMessages } from "../transport/gotify-api.js";
import { readBacklogCursor, writeBacklogCursor } from "./backlog-cursor.js";

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

function parsePositiveMessageId(id: number | string | undefined): number {
  const normalized =
    typeof id === "number" ? Math.trunc(id) : Number.parseInt(String(id ?? ""), 10);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : 0;
}

/**
 * 启动阶段补拉停机期间的指定应用历史消息。
 *
 * replay 顺序严格按 message id 升序，一条完成后才推进到下一条；不会把整批消息一次性塞给智能体。
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
