import type {
  GotifyApplicationInfo,
  GotifyClientInfo,
  GotifyDoctorReport,
  GotifyMessagePayload,
  GotifyMessageResponse,
  GotifyPagedMessages,
  ResolvedGotifyAccount,
} from './types.js';

export interface GotifyFetchOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  retryCount?: number;
  retryDelayMs?: number;
}

// ── 账号级并发锁 ────────────────────────────────────────────────────────────────
const accountLocks = new Map<string, Promise<void>>();

function normalizeServerUrl(serverUrl: string): string {
  return serverUrl.replace(/\/+$/, '');
}

function buildAuthUrl(
  account: ResolvedGotifyAccount,
  path: string,
  useClientToken: boolean
): string {
  if (!account.serverUrl) {
    throw new Error(`Gotify account ${account.accountId} is missing serverUrl.`);
  }
  if (useClientToken && !account.clientToken) {
    throw new Error(`Gotify account ${account.accountId} is missing clientToken.`);
  }
  return `${normalizeServerUrl(account.serverUrl)}${path}`;
}

function buildClientHeaders(account: ResolvedGotifyAccount): HeadersInit {
  if (!account.clientToken) {
    throw new Error(`Gotify account ${account.accountId} is missing clientToken.`);
  }
  return { 'X-Gotify-Key': account.clientToken };
}

// ── 账号级并发锁工具 ──────────────────────────────────────────────────────────
async function withAccountLock<T>(accountId: string, task: () => Promise<T>): Promise<T> {
  const prev = accountLocks.get(accountId);
  const lock: Promise<void> = (prev ?? Promise.resolve()).then(() => undefined);
  accountLocks.set(accountId, lock);

  try {
    await lock;
    return await task();
  } finally {
    if (accountLocks.get(accountId) === lock) {
      accountLocks.delete(accountId);
    }
  }
}

// ── HTTP 工具 ──────────────────────────────────────────────────────────────────

async function fetchWithRetry(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  options: Pick<GotifyFetchOptions, 'timeoutMs' | 'retryCount' | 'retryDelayMs'> = {}
): Promise<Response> {
  const retryCount = Math.max(0, options.retryCount ?? 1);
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 250);
  const timeoutMs = Math.max(0, options.timeoutMs ?? 8000);

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retryCount; attempt++) {
    try {
      const response = await fetchWithTimeout(fetchImpl, url, init, timeoutMs);
      if (response.ok) return response;
      if (response.status >= 500 && attempt < retryCount) {
        await sleep(retryDelayMs);
        continue;
      }
      const body = await safeReadText(response);
      throw new Error(`Gotify API failed (${response.status}): ${body}`);
    } catch (error) {
      lastError = error;
      if (attempt >= retryCount) break;
      await sleep(retryDelayMs);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  if (!timeoutMs) return await fetchImpl(url, init);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '<unreadable body>';
  }
}

// ── Message API ────────────────────────────────────────────────────────────────

/**
 * 构造 Message API POST 请求对象。
 */
export function buildMessageRequest(
  account: ResolvedGotifyAccount,
  payload: GotifyMessagePayload
): { url: string; init: RequestInit } {
  if (!account.serverUrl || !account.appToken) {
    throw new Error(`Gotify account ${account.accountId} is not configured for outbound delivery.`);
  }
  return {
    url: `${normalizeServerUrl(account.serverUrl)}/message`,
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Gotify-Key': account.appToken,
      },
      body: JSON.stringify(payload),
    },
  };
}

/**
 * 发送消息 — POST /message (App Token)
 */
export async function sendGotifyMessage(
  account: ResolvedGotifyAccount,
  payload: GotifyMessagePayload,
  options: GotifyFetchOptions = {}
): Promise<GotifyMessageResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const request = buildMessageRequest(account, payload);

  return withAccountLock(account.accountId, async () => {
    const response = await fetchWithRetry(fetchImpl, request.url, request.init, options);
    return (await response.json()) as GotifyMessageResponse;
  });
}

/**
 * 获取消息列表 — GET /message (Client Token)
 * 支持游标分页: limit (1-200, 默认100), since (消息ID)
 */
export async function getMessages(
  account: ResolvedGotifyAccount,
  params?: { limit?: number; since?: number },
  options: GotifyFetchOptions = {}
): Promise<GotifyPagedMessages> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const limit = Math.min(200, Math.max(1, params?.limit ?? 100));
  const query = new URLSearchParams({ limit: String(limit) });
  if (params?.since !== undefined && params.since > 0) {
    query.set('since', String(params.since));
  }

  return withAccountLock(account.accountId, async () => {
    const response = await fetchWithRetry(
      fetchImpl,
      `${buildAuthUrl(account, '/message', true)}?${query.toString()}`,
      { headers: buildClientHeaders(account) },
      options
    );
    return (await response.json()) as GotifyPagedMessages;
  });
}

/**
 * 删除全部消息 — DELETE /message (Client Token)
 */
export async function deleteAllMessages(
  account: ResolvedGotifyAccount,
  options: GotifyFetchOptions = {}
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;

  await withAccountLock(account.accountId, async () => {
    await fetchWithRetry(
      fetchImpl,
      buildAuthUrl(account, '/message', true),
      { method: 'DELETE', headers: buildClientHeaders(account) },
      options
    );
  });
}

/**
 * 删除单条消息 — DELETE /message/{id} (Client Token)
 */
export async function deleteMessage(
  account: ResolvedGotifyAccount,
  messageId: number,
  options: GotifyFetchOptions = {}
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;

  await withAccountLock(account.accountId, async () => {
    await fetchWithRetry(
      fetchImpl,
      buildAuthUrl(account, `/message/${messageId}`, true),
      { method: 'DELETE', headers: buildClientHeaders(account) },
      options
    );
  });
}

/**
 * 获取指定应用的消息 — GET /application/{id}/message (Client Token)
 */
export async function getApplicationMessages(
  account: ResolvedGotifyAccount,
  applicationId: number,
  params?: { limit?: number; since?: number },
  options: GotifyFetchOptions = {}
): Promise<GotifyPagedMessages> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const limit = Math.min(200, Math.max(1, params?.limit ?? 100));
  const query = new URLSearchParams({ limit: String(limit) });
  if (params?.since !== undefined && params.since > 0) {
    query.set('since', String(params.since));
  }

  return withAccountLock(account.accountId, async () => {
    const response = await fetchWithRetry(
      fetchImpl,
      `${buildAuthUrl(account, `/application/${applicationId}/message`, true)}?${query.toString()}`,
      { headers: buildClientHeaders(account) },
      options
    );
    return (await response.json()) as GotifyPagedMessages;
  });
}

/**
 * 删除指定应用的全部消息 — DELETE /application/{id}/message (Client Token)
 */
export async function deleteApplicationMessages(
  account: ResolvedGotifyAccount,
  applicationId: number,
  options: GotifyFetchOptions = {}
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;

  await withAccountLock(account.accountId, async () => {
    await fetchWithRetry(
      fetchImpl,
      buildAuthUrl(account, `/application/${applicationId}/message`, true),
      { method: 'DELETE', headers: buildClientHeaders(account) },
      options
    );
  });
}

// ── Application API ────────────────────────────────────────────────────────────

/**
 * 获取应用列表 — GET /application (Client Token)
 */
export async function listApplications(
  account: ResolvedGotifyAccount,
  options: GotifyFetchOptions = {}
): Promise<GotifyApplicationInfo[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchWithRetry(
    fetchImpl,
    buildAuthUrl(account, '/application', true),
    { headers: buildClientHeaders(account) },
    options
  );
  return (await response.json()) as GotifyApplicationInfo[];
}

/**
 * 创建应用 — POST /application (Client Token)
 */
export async function createApplication(
  account: ResolvedGotifyAccount,
  params: { name: string; description?: string; defaultPriority?: number },
  options: GotifyFetchOptions = {}
): Promise<GotifyApplicationInfo> {
  const fetchImpl = options.fetchImpl ?? fetch;

  return withAccountLock(account.accountId, async () => {
    const response = await fetchWithRetry(
      fetchImpl,
      buildAuthUrl(account, '/application', true),
      {
        method: 'POST',
        headers: {
          ...buildClientHeaders(account),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
      },
      options
    );
    return (await response.json()) as GotifyApplicationInfo;
  });
}

/**
 * 更新应用 — PUT /application/{id} (Client Token)
 */
export async function updateApplication(
  account: ResolvedGotifyAccount,
  applicationId: number,
  params: { name: string; description?: string; defaultPriority?: number },
  options: GotifyFetchOptions = {}
): Promise<GotifyApplicationInfo> {
  const fetchImpl = options.fetchImpl ?? fetch;

  return withAccountLock(account.accountId, async () => {
    const response = await fetchWithRetry(
      fetchImpl,
      buildAuthUrl(account, `/application/${applicationId}`, true),
      {
        method: 'PUT',
        headers: {
          ...buildClientHeaders(account),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
      },
      options
    );
    return (await response.json()) as GotifyApplicationInfo;
  });
}

/**
 * 删除应用 — DELETE /application/{id} (Client Token)
 * 注意：内部应用 (internal=true) 无法删除。
 */
export async function deleteApplication(
  account: ResolvedGotifyAccount,
  applicationId: number,
  options: GotifyFetchOptions = {}
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;

  await withAccountLock(account.accountId, async () => {
    await fetchWithRetry(
      fetchImpl,
      buildAuthUrl(account, `/application/${applicationId}`, true),
      { method: 'DELETE', headers: buildClientHeaders(account) },
      options
    );
  });
}

/**
 * 上传应用图片 — POST /application/{id}/image (Client Token)
 * 仅接受 .gif/.png/.jpg/.jpeg 格式。
 */
export async function uploadApplicationImage(
  account: ResolvedGotifyAccount,
  applicationId: number,
  imageBuffer: Buffer,
  filename: string,
  options: GotifyFetchOptions = {}
): Promise<GotifyApplicationInfo> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const mimeMap: Record<string, string> = {
    gif: 'image/gif',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
  };
  const mimeType = mimeMap[ext] ?? 'application/octet-stream';

  const blob = new Blob([new Uint8Array(imageBuffer)], { type: mimeType });
  const formData = new FormData();
  formData.append('image', blob, filename);

  return withAccountLock(account.accountId, async () => {
    const response = await fetchWithRetry(
      fetchImpl,
      buildAuthUrl(account, `/application/${applicationId}/image`, true),
      {
        method: 'POST',
        headers: buildClientHeaders(account),
        body: formData,
      },
      options
    );
    return (await response.json()) as GotifyApplicationInfo;
  });
}

// ── Client API ─────────────────────────────────────────────────────────────────

/**
 * 获取客户端列表 — GET /client (Client Token)
 */
export async function listClients(
  account: ResolvedGotifyAccount,
  options: GotifyFetchOptions = {}
): Promise<GotifyClientInfo[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchWithRetry(
    fetchImpl,
    buildAuthUrl(account, '/client', true),
    { headers: buildClientHeaders(account) },
    options
  );
  return (await response.json()) as GotifyClientInfo[];
}

/**
 * 创建客户端 — POST /client (Client Token)
 */
export async function createClient(
  account: ResolvedGotifyAccount,
  params: { name: string },
  options: GotifyFetchOptions = {}
): Promise<GotifyClientInfo> {
  const fetchImpl = options.fetchImpl ?? fetch;

  return withAccountLock(account.accountId, async () => {
    const response = await fetchWithRetry(
      fetchImpl,
      buildAuthUrl(account, '/client', true),
      {
        method: 'POST',
        headers: {
          ...buildClientHeaders(account),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
      },
      options
    );
    return (await response.json()) as GotifyClientInfo;
  });
}

/**
 * 更新客户端 — PUT /client/{id} (Client Token)
 */
export async function updateClient(
  account: ResolvedGotifyAccount,
  clientId: number,
  params: { name: string },
  options: GotifyFetchOptions = {}
): Promise<GotifyClientInfo> {
  const fetchImpl = options.fetchImpl ?? fetch;

  return withAccountLock(account.accountId, async () => {
    const response = await fetchWithRetry(
      fetchImpl,
      buildAuthUrl(account, `/client/${clientId}`, true),
      {
        method: 'PUT',
        headers: {
          ...buildClientHeaders(account),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
      },
      options
    );
    return (await response.json()) as GotifyClientInfo;
  });
}

/**
 * 删除客户端 — DELETE /client/{id} (Client Token)
 */
export async function deleteClient(
  account: ResolvedGotifyAccount,
  clientId: number,
  options: GotifyFetchOptions = {}
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;

  await withAccountLock(account.accountId, async () => {
    await fetchWithRetry(
      fetchImpl,
      buildAuthUrl(account, `/client/${clientId}`, true),
      { method: 'DELETE', headers: buildClientHeaders(account) },
      options
    );
  });
}

// ── Health ─────────────────────────────────────────────────────────────────────

/**
 * 健康检查 — GET /health (无需认证)
 */
export async function healthCheck(
  account: ResolvedGotifyAccount,
  options: GotifyFetchOptions = {}
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const start = Date.now();
  try {
    await fetchWithRetry(
      fetchImpl,
      buildAuthUrl(account, '/health', false),
      {},
      { ...options, retryCount: 0 }
    );
    return { ok: true, latencyMs: Date.now() - start };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - start, error: String(error) };
  }
}

// ── Doctor ─────────────────────────────────────────────────────────────────────

/**
 * 生成 doctor 报告，验证 Gotify 服务连通性和配置完整性。
 */
export async function runGotifyDoctor(
  account: ResolvedGotifyAccount,
  options: GotifyFetchOptions = {}
): Promise<GotifyDoctorReport> {
  const errors: string[] = [];
  let applicationsChecked = false;
  let clientsChecked = false;
  let healthOk = false;

  if (!account.serverUrl) {
    errors.push('Missing serverUrl.');
  }
  if (!account.appToken) {
    errors.push('Missing appToken.');
  }

  // 健康检查
  if (account.serverUrl) {
    const health = await healthCheck(account, options);
    healthOk = health.ok;
    if (!health.ok) {
      errors.push(`Health check failed: ${health.error}`);
    }
  }

  // 验证 clientToken 可用性
  if (account.clientToken && healthOk) {
    try {
      await listApplications(account, options);
      applicationsChecked = true;
    } catch (error) {
      errors.push(`Application API: ${String(error)}`);
    }
    try {
      await listClients(account, options);
      clientsChecked = true;
    } catch (error) {
      errors.push(`Client API: ${String(error)}`);
    }
  }

  return {
    ok: errors.length === 0,
    serverUrl: account.serverUrl,
    hasAppToken: Boolean(account.appToken),
    hasClientToken: Boolean(account.clientToken),
    healthOk,
    applicationsChecked,
    clientsChecked,
    errors,
  };
}

// ── 遗留导出（向后兼容） ─────────────────────────────────────────────────────
export { normalizeServerUrl };
