/**
 * Response URL Tracker
 *
 * Tracks WeCom response_url values for proactive message delivery.
 * Implements 55-minute TTL and single-use consumption semantics.
 *
 * Source: openclaw-china/wecom/src/outbound-reply.ts (partial)
 */

type ResponseEndpoint = {
  url: string;
  createdAt: number;
  expiresAt: number;
};

const RESPONSE_URL_TTL_MS = 55 * 60 * 1000;

const responseEndpoints = new Map<string, ResponseEndpoint[]>();

function endpointKey(accountId: string, to: string): string {
  return `${accountId}::${to}`;
}

function now(): number {
  return Date.now();
}

function pruneExpiredResponseUrls(): void {
  const ts = now();
  for (const [key, list] of responseEndpoints.entries()) {
    const active = list.filter((entry) => entry.expiresAt > ts);
    if (active.length > 0) {
      responseEndpoints.set(key, active);
    } else {
      responseEndpoints.delete(key);
    }
  }
}

export function registerResponseUrl(params: {
  accountId: string;
  to: string;
  responseUrl: string;
}): void {
  const accountId = params.accountId.trim();
  const to = params.to.trim();
  const responseUrl = params.responseUrl.trim();
  if (!accountId || !to || !responseUrl) return;

  pruneExpiredResponseUrls();
  const key = endpointKey(accountId, to);
  const list = responseEndpoints.get(key) ?? [];
  if (list.some((entry) => entry.url === responseUrl)) return;

  list.push({
    url: responseUrl,
    createdAt: now(),
    expiresAt: now() + RESPONSE_URL_TTL_MS,
  });
  responseEndpoints.set(key, list);
}

export function consumeResponseUrl(params: {
  accountId: string;
  to: string;
}): string | null {
  const accountId = params.accountId.trim();
  const to = params.to.trim();
  if (!accountId || !to) return null;

  pruneExpiredResponseUrls();
  const key = endpointKey(accountId, to);
  const list = responseEndpoints.get(key) ?? [];
  if (list.length === 0) return null;

  // response_url is single-use: consume latest and remove it from the store.
  const next = list.pop();
  if (!next?.url) return null;

  if (list.length > 0) {
    responseEndpoints.set(key, list);
  } else {
    responseEndpoints.delete(key);
  }
  return next.url;
}

// Only for tests
export function clearResponseUrlState(): void {
  responseEndpoints.clear();
}
