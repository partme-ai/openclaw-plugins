/**
 * Gotify REST API 客户端 — 完整 Gotify Server API 封装。
 *
 * ## 消息 API (appToken)
 * - POST /message — 发送消息
 * - GET /message — 获取消息列表（游标分页）
 * - DELETE /message — 删除全部消息
 * - DELETE /message/{id} — 删除单条消息
 *
 * ## Application API (clientToken)
 * - GET/POST/PUT/DELETE /application — CRUD
 * - POST /application/{id}/image — 上传图标
 *
 * ## Client API (clientToken)
 * - GET/POST/PUT/DELETE /client — CRUD
 *
 * ## 基础设施
 * - GET /health — 健康检查
 * - 账号级并发锁 (withAccountLock) — 串行化同账号请求
 * - HTTP 重试 (fetchWithRetry) — 5xx 自动重试
 * - 超时控制 (fetchWithTimeout) — AbortController
 * - 应用名称缓存 (resolveApplicationName) — per-account Map
 */

import type {
  GotifyApplicationInfo,
  GotifyClientInfo,
  GotifyDoctorReport,
  GotifyMessagePayload,
  GotifyMessageResponse,
  GotifyPagedMessages,
  ResolvedGotifyAccount,
} from "../types.js";
import {
  GotifyApiError,
  GotifyConnectionError,
  GotifyTimeoutError,
  GotifyConfigError,
} from "../errors.js";

/**
 * Gotify API 调用的 fetch 行为选项。
 *
 * 这些选项主要用于测试注入和 operator 调整网络容错；业务调用方通常不需要传入。
 */
export interface GotifyFetchOptions {
  /** 测试或宿主注入的 fetch 实现；默认使用 Node 全局 fetch。 */
  fetchImpl?: typeof fetch;
  /** 单次请求超时时间，单位毫秒；0 表示不启用 AbortController 超时。 */
  timeoutMs?: number;
  /** 失败重试次数；5xx 与网络错误可重试，4xx 不重试。 */
  retryCount?: number;
  /** 两次重试之间的等待时间，单位毫秒。 */
  retryDelayMs?: number;
}

// ── 账号级并发锁 ────────────────────────────────────────────────────────────────
const accountLocks = new Map<string, Promise<void>>();

/**
 * 规范化 Gotify serverUrl，去掉尾部斜杠。
 *
 * @param serverUrl - 用户配置的 Gotify Server base URL。
 * @returns 没有尾部斜杠的 base URL，便于安全拼接 path。
 */
function normalizeServerUrl(serverUrl: string): string {
  return serverUrl.replace(/\/+$/, "");
}

/**
 * 构造需要认证的 Gotify API URL，并验证所需 token 是否存在。
 *
 * @param account - 已解析 Gotify 账号。
 * @param path - API path，例如 `/message` 或 `/application`。
 * @param useClientToken - 当前 API 是否要求 clientToken。
 * @returns 完整请求 URL。
 */
function buildAuthUrl(
  account: ResolvedGotifyAccount,
  path: string,
  useClientToken: boolean,
): string {
  if (!account.serverUrl) {
    throw new GotifyConfigError("serverUrl", "missing server URL");
  }
  if (useClientToken && !account.clientToken) {
    throw new GotifyConfigError(
      "clientToken",
      "client token required for this operation",
    );
  }
  return `${normalizeServerUrl(account.serverUrl)}${path}`;
}

/**
 * 构造 Client API 使用的认证头。
 *
 * @param account - 已解析 Gotify 账号。
 * @returns 包含 `X-Gotify-Key` 的 HeadersInit。
 */
function buildClientHeaders(account: ResolvedGotifyAccount): HeadersInit {
  if (!account.clientToken) {
    throw new GotifyConfigError(
      "clientToken",
      "client token required for this operation",
    );
  }
  return { "X-Gotify-Key": account.clientToken };
}

// ── 账号级并发锁工具 ──────────────────────────────────────────────────────────
/**
 * 按账号串行执行 Gotify API 任务。
 *
 * @typeParam T - 任务返回值类型。
 * @param accountId - Gotify 账号 ID。
 * @param task - 需要在账号级锁内执行的异步任务。
 * @returns task 的返回值。
 */
async function withAccountLock<T>(
  accountId: string,
  task: () => Promise<T>,
): Promise<T> {
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

/**
 * 执行带超时与重试的 fetch。
 *
 * 规则：
 * - 2xx/3xx 直接返回 Response。
 * - 5xx 在 retryCount 范围内重试。
 * - 4xx 读取响应正文并抛出 GotifyApiError，不重试。
 * - 网络错误重试，最终包装为 GotifyConnectionError。
 *
 * @param fetchImpl - 实际 fetch 实现。
 * @param url - 请求 URL。
 * @param init - fetch RequestInit。
 * @param options - 超时和重试参数。
 * @returns 成功响应。
 */
async function fetchWithRetry(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  options: Pick<
    GotifyFetchOptions,
    "timeoutMs" | "retryCount" | "retryDelayMs"
  > = {},
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
      throw new GotifyApiError(
        `Gotify API failed (${response.status}): ${body}`,
        response.status,
      );
    } catch (error) {
      lastError = error;
      if (
        error instanceof GotifyApiError ||
        error instanceof GotifyTimeoutError
      ) {
        throw error; // Don't retry typed errors
      }
      if (attempt >= retryCount) break;
      await sleep(retryDelayMs);
    }
  }
  if (lastError instanceof Error) {
    throw new GotifyConnectionError(lastError.message);
  }
  throw new GotifyConnectionError(String(lastError));
}

/**
 * 执行单次带 AbortController 超时的 fetch。
 *
 * @param fetchImpl - 实际 fetch 实现。
 * @param url - 请求 URL。
 * @param init - fetch RequestInit。
 * @param timeoutMs - 超时时间，0 表示不设置超时。
 * @returns fetch 响应。
 */
async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  if (!timeoutMs) return await fetchImpl(url, init);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new GotifyTimeoutError(timeoutMs, "fetch request");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 等待指定时间。
 *
 * @param ms - 等待毫秒数；小于等于 0 时立即返回。
 */
async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 安全读取错误响应正文。
 *
 * @param response - fetch Response。
 * @returns 响应文本；读取失败时返回占位字符串。
 */
async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "<unreadable body>";
  }
}

// ── Message API ────────────────────────────────────────────────────────────────

/**
 * 构造 Message API POST 请求对象。
 *
 * @param account - 已解析 Gotify 账号，必须具备 serverUrl 与 appToken。
 * @param payload - Gotify Message API payload。
 * @returns 请求 URL 与 RequestInit，供测试断言或 `sendGotifyMessage()` 使用。
 */
export function buildMessageRequest(
  account: ResolvedGotifyAccount,
  payload: GotifyMessagePayload,
): { url: string; init: RequestInit } {
  if (!account.serverUrl || !account.appToken) {
    throw new GotifyConfigError(
      "serverUrl/appToken",
      "account not configured for outbound delivery",
    );
  }
  return {
    url: `${normalizeServerUrl(account.serverUrl)}/message`,
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Gotify-Key": account.appToken,
      },
      body: JSON.stringify(payload),
    },
  };
}

/**
 * 发送消息 — POST /message (App Token)
 *
 * @param account - 已解析 Gotify 账号。
 * @param payload - 消息 payload。
 * @param options - 可选 fetch/超时/重试参数。
 * @returns Gotify 创建后的消息响应。
 */
export async function sendGotifyMessage(
  account: ResolvedGotifyAccount,
  payload: GotifyMessagePayload,
  options: GotifyFetchOptions = {},
): Promise<GotifyMessageResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const request = buildMessageRequest(account, payload);

  return withAccountLock(account.accountId, async () => {
    const response = await fetchWithRetry(
      fetchImpl,
      request.url,
      request.init,
      options,
    );
    return (await response.json()) as GotifyMessageResponse;
  });
}

/**
 * 出站投递用：首次失败后等待一次再重试（共最多 2 次 POST），提高一来一回回复可靠性。
 *
 * @param account - 已解析 Gotify 账号。
 * @param payload - 消息 payload。
 * @param options - 可选 fetch/超时/重试参数。
 * @returns Gotify 创建后的消息响应。
 */
export async function sendGotifyMessageWithDeliveryRetry(
  account: ResolvedGotifyAccount,
  payload: GotifyMessagePayload,
  options: GotifyFetchOptions = {},
): Promise<GotifyMessageResponse> {
  try {
    return await sendGotifyMessage(account, payload, options);
  } catch (firstError) {
    await sleep(Math.max(0, options.retryDelayMs ?? 300));
    try {
      return await sendGotifyMessage(account, payload, {
        ...options,
        retryCount: 0,
      });
    } catch {
      throw firstError;
    }
  }
}

/**
 * 获取消息列表 — GET /message (Client Token)
 * 支持游标分页: limit (1-200, 默认100), since (消息ID)
 *
 * @param account - 已解析 Gotify 账号，必须具备 clientToken。
 * @param params - 分页参数。
 * @param options - 可选 fetch/超时/重试参数。
 * @returns Gotify 分页消息列表。
 */
export async function getMessages(
  account: ResolvedGotifyAccount,
  params?: { limit?: number; since?: number },
  options: GotifyFetchOptions = {},
): Promise<GotifyPagedMessages> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const limit = Math.min(200, Math.max(1, params?.limit ?? 100));
  const query = new URLSearchParams({ limit: String(limit) });
  if (params?.since !== undefined && params.since > 0) {
    query.set("since", String(params.since));
  }

  return withAccountLock(account.accountId, async () => {
    const response = await fetchWithRetry(
      fetchImpl,
      `${buildAuthUrl(account, "/message", true)}?${query.toString()}`,
      { headers: buildClientHeaders(account) },
      options,
    );
    return (await response.json()) as GotifyPagedMessages;
  });
}

/**
 * 删除全部消息 — DELETE /message (Client Token)
 *
 * @param account - 已解析 Gotify 账号，必须具备 clientToken。
 * @param options - 可选 fetch/超时/重试参数。
 */
export async function deleteAllMessages(
  account: ResolvedGotifyAccount,
  options: GotifyFetchOptions = {},
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;

  await withAccountLock(account.accountId, async () => {
    await fetchWithRetry(
      fetchImpl,
      buildAuthUrl(account, "/message", true),
      { method: "DELETE", headers: buildClientHeaders(account) },
      options,
    );
  });
}

/**
 * 删除单条消息 — DELETE /message/{id} (Client Token)
 *
 * @param account - 已解析 Gotify 账号，必须具备 clientToken。
 * @param messageId - 要删除的 Gotify message ID。
 * @param options - 可选 fetch/超时/重试参数。
 */
export async function deleteMessage(
  account: ResolvedGotifyAccount,
  messageId: number,
  options: GotifyFetchOptions = {},
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;

  await withAccountLock(account.accountId, async () => {
    await fetchWithRetry(
      fetchImpl,
      buildAuthUrl(account, `/message/${messageId}`, true),
      { method: "DELETE", headers: buildClientHeaders(account) },
      options,
    );
  });
}

/**
 * 获取指定应用的消息 — GET /application/{id}/message (Client Token)
 *
 * @param account - 已解析 Gotify 账号，必须具备 clientToken。
 * @param applicationId - Gotify Application ID。
 * @param params - 分页参数。
 * @param options - 可选 fetch/超时/重试参数。
 * @returns 指定 Application 的分页消息列表。
 */
export async function getApplicationMessages(
  account: ResolvedGotifyAccount,
  applicationId: number,
  params?: { limit?: number; since?: number },
  options: GotifyFetchOptions = {},
): Promise<GotifyPagedMessages> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const limit = Math.min(200, Math.max(1, params?.limit ?? 100));
  const query = new URLSearchParams({ limit: String(limit) });
  if (params?.since !== undefined && params.since > 0) {
    query.set("since", String(params.since));
  }

  return withAccountLock(account.accountId, async () => {
    const response = await fetchWithRetry(
      fetchImpl,
      `${buildAuthUrl(account, `/application/${applicationId}/message`, true)}?${query.toString()}`,
      { headers: buildClientHeaders(account) },
      options,
    );
    return (await response.json()) as GotifyPagedMessages;
  });
}

/**
 * 删除指定应用的全部消息 — DELETE /application/{id}/message (Client Token)
 *
 * @param account - 已解析 Gotify 账号，必须具备 clientToken。
 * @param applicationId - Gotify Application ID。
 * @param options - 可选 fetch/超时/重试参数。
 */
export async function deleteApplicationMessages(
  account: ResolvedGotifyAccount,
  applicationId: number,
  options: GotifyFetchOptions = {},
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;

  await withAccountLock(account.accountId, async () => {
    await fetchWithRetry(
      fetchImpl,
      buildAuthUrl(account, `/application/${applicationId}/message`, true),
      { method: "DELETE", headers: buildClientHeaders(account) },
      options,
    );
  });
}

// ── Application API ────────────────────────────────────────────────────────────

/** 账号级应用名称缓存：accountId → (appId → name)。 */
const applicationNameCache = new Map<string, Map<number, string>>();

/**
 * 清空应用名称缓存（测试或账号配置变更时使用）。
 *
 * @param accountId - 指定账号 ID；不传时清空全部账号缓存。
 */
export function clearApplicationNameCache(accountId?: string): void {
  if (accountId) {
    applicationNameCache.delete(accountId);
  } else {
    applicationNameCache.clear();
  }
}

/**
 * 按 appId 从缓存或 GET /application 列表解析应用展示名。
 * 首次未命中时拉取全量应用列表并写入 per-account 缓存，避免每条消息重复请求。
 *
 * @param account - 已解析 Gotify 账号，必须具备 clientToken 才能请求 Application API。
 * @param applicationId - Gotify Application ID。
 * @param options - 可选 fetch/超时/重试参数。
 * @returns 应用名；无法解析或没有 clientToken 时返回 undefined。
 */
export async function resolveApplicationName(
  account: ResolvedGotifyAccount,
  applicationId: number,
  options: GotifyFetchOptions = {},
): Promise<string | undefined> {
  const appId = Math.trunc(applicationId);
  if (!Number.isFinite(appId) || appId <= 0) {
    return undefined;
  }
  if (!account.clientToken) {
    return undefined;
  }

  let accountCache = applicationNameCache.get(account.accountId);
  if (!accountCache) {
    accountCache = new Map();
    applicationNameCache.set(account.accountId, accountCache);
  }

  const cached = accountCache.get(appId);
  if (cached) {
    return cached;
  }

  try {
    const applications = await listApplications(account, options);
    for (const app of applications) {
      const name = app.name?.trim();
      if (name) {
        accountCache.set(app.id, name);
      }
    }
  } catch {
    return undefined;
  }

  return accountCache.get(appId);
}

/**
 * 获取应用列表 — GET /application (Client Token)
 *
 * @param account - 已解析 Gotify 账号，必须具备 clientToken。
 * @param options - 可选 fetch/超时/重试参数。
 * @returns Gotify Application 列表。
 */
export async function listApplications(
  account: ResolvedGotifyAccount,
  options: GotifyFetchOptions = {},
): Promise<GotifyApplicationInfo[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchWithRetry(
    fetchImpl,
    buildAuthUrl(account, "/application", true),
    { headers: buildClientHeaders(account) },
    options,
  );
  return (await response.json()) as GotifyApplicationInfo[];
}

/**
 * 创建应用 — POST /application (Client Token)
 *
 * @param account - 已解析 Gotify 账号，必须具备 clientToken。
 * @param params - Application 名称、描述和默认优先级。
 * @param options - 可选 fetch/超时/重试参数。
 * @returns 创建后的 Application 信息。
 */
export async function createApplication(
  account: ResolvedGotifyAccount,
  params: { name: string; description?: string; defaultPriority?: number },
  options: GotifyFetchOptions = {},
): Promise<GotifyApplicationInfo> {
  const fetchImpl = options.fetchImpl ?? fetch;

  return withAccountLock(account.accountId, async () => {
    const response = await fetchWithRetry(
      fetchImpl,
      buildAuthUrl(account, "/application", true),
      {
        method: "POST",
        headers: {
          ...buildClientHeaders(account),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(params),
      },
      options,
    );
    return (await response.json()) as GotifyApplicationInfo;
  });
}

/**
 * 更新应用 — PUT /application/{id} (Client Token)
 *
 * @param account - 已解析 Gotify 账号，必须具备 clientToken。
 * @param applicationId - 要更新的 Gotify Application ID。
 * @param params - 更新后的 Application 字段。
 * @param options - 可选 fetch/超时/重试参数。
 * @returns 更新后的 Application 信息。
 */
export async function updateApplication(
  account: ResolvedGotifyAccount,
  applicationId: number,
  params: { name: string; description?: string; defaultPriority?: number },
  options: GotifyFetchOptions = {},
): Promise<GotifyApplicationInfo> {
  const fetchImpl = options.fetchImpl ?? fetch;

  return withAccountLock(account.accountId, async () => {
    const response = await fetchWithRetry(
      fetchImpl,
      buildAuthUrl(account, `/application/${applicationId}`, true),
      {
        method: "PUT",
        headers: {
          ...buildClientHeaders(account),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(params),
      },
      options,
    );
    return (await response.json()) as GotifyApplicationInfo;
  });
}

/**
 * 删除应用 — DELETE /application/{id} (Client Token)
 * 注意：内部应用 (internal=true) 无法删除。
 *
 * @param account - 已解析 Gotify 账号，必须具备 clientToken。
 * @param applicationId - 要删除的 Gotify Application ID。
 * @param options - 可选 fetch/超时/重试参数。
 */
export async function deleteApplication(
  account: ResolvedGotifyAccount,
  applicationId: number,
  options: GotifyFetchOptions = {},
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;

  await withAccountLock(account.accountId, async () => {
    await fetchWithRetry(
      fetchImpl,
      buildAuthUrl(account, `/application/${applicationId}`, true),
      { method: "DELETE", headers: buildClientHeaders(account) },
      options,
    );
  });
}

/**
 * 上传应用图片 — POST /application/{id}/image (Client Token)
 * 仅接受 .gif/.png/.jpg/.jpeg 格式。
 *
 * @param account - 已解析 Gotify 账号，必须具备 clientToken。
 * @param applicationId - 要上传图标的 Gotify Application ID。
 * @param imageBuffer - 图片二进制内容。
 * @param filename - 原始文件名，用于推断 MIME 类型并传给 FormData。
 * @param options - 可选 fetch/超时/重试参数。
 * @returns 更新后的 Application 信息。
 */
export async function uploadApplicationImage(
  account: ResolvedGotifyAccount,
  applicationId: number,
  imageBuffer: Buffer,
  filename: string,
  options: GotifyFetchOptions = {},
): Promise<GotifyApplicationInfo> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const mimeMap: Record<string, string> = {
    gif: "image/gif",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
  };
  const mimeType = mimeMap[ext] ?? "application/octet-stream";

  const blob = new Blob([new Uint8Array(imageBuffer)], { type: mimeType });
  const formData = new FormData();
  formData.append("image", blob, filename);

  return withAccountLock(account.accountId, async () => {
    const response = await fetchWithRetry(
      fetchImpl,
      buildAuthUrl(account, `/application/${applicationId}/image`, true),
      {
        method: "POST",
        headers: buildClientHeaders(account),
        body: formData,
      },
      options,
    );
    return (await response.json()) as GotifyApplicationInfo;
  });
}

// ── Client API ─────────────────────────────────────────────────────────────────

/**
 * 获取客户端列表 — GET /client (Client Token)
 *
 * @param account - 已解析 Gotify 账号，必须具备 clientToken。
 * @param options - 可选 fetch/超时/重试参数。
 * @returns Gotify Client 列表。
 */
export async function listClients(
  account: ResolvedGotifyAccount,
  options: GotifyFetchOptions = {},
): Promise<GotifyClientInfo[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchWithRetry(
    fetchImpl,
    buildAuthUrl(account, "/client", true),
    { headers: buildClientHeaders(account) },
    options,
  );
  return (await response.json()) as GotifyClientInfo[];
}

/**
 * 创建客户端 — POST /client (Client Token)
 *
 * @param account - 已解析 Gotify 账号，必须具备 clientToken。
 * @param params - Client 名称。
 * @param options - 可选 fetch/超时/重试参数。
 * @returns 创建后的 Client 信息。
 */
export async function createClient(
  account: ResolvedGotifyAccount,
  params: { name: string },
  options: GotifyFetchOptions = {},
): Promise<GotifyClientInfo> {
  const fetchImpl = options.fetchImpl ?? fetch;

  return withAccountLock(account.accountId, async () => {
    const response = await fetchWithRetry(
      fetchImpl,
      buildAuthUrl(account, "/client", true),
      {
        method: "POST",
        headers: {
          ...buildClientHeaders(account),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(params),
      },
      options,
    );
    return (await response.json()) as GotifyClientInfo;
  });
}

/**
 * 更新客户端 — PUT /client/{id} (Client Token)
 *
 * @param account - 已解析 Gotify 账号，必须具备 clientToken。
 * @param clientId - 要更新的 Gotify Client ID。
 * @param params - 更新后的 Client 字段。
 * @param options - 可选 fetch/超时/重试参数。
 * @returns 更新后的 Client 信息。
 */
export async function updateClient(
  account: ResolvedGotifyAccount,
  clientId: number,
  params: { name: string },
  options: GotifyFetchOptions = {},
): Promise<GotifyClientInfo> {
  const fetchImpl = options.fetchImpl ?? fetch;

  return withAccountLock(account.accountId, async () => {
    const response = await fetchWithRetry(
      fetchImpl,
      buildAuthUrl(account, `/client/${clientId}`, true),
      {
        method: "PUT",
        headers: {
          ...buildClientHeaders(account),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(params),
      },
      options,
    );
    return (await response.json()) as GotifyClientInfo;
  });
}

/**
 * 删除客户端 — DELETE /client/{id} (Client Token)
 *
 * @param account - 已解析 Gotify 账号，必须具备 clientToken。
 * @param clientId - 要删除的 Gotify Client ID。
 * @param options - 可选 fetch/超时/重试参数。
 */
export async function deleteClient(
  account: ResolvedGotifyAccount,
  clientId: number,
  options: GotifyFetchOptions = {},
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;

  await withAccountLock(account.accountId, async () => {
    await fetchWithRetry(
      fetchImpl,
      buildAuthUrl(account, `/client/${clientId}`, true),
      { method: "DELETE", headers: buildClientHeaders(account) },
      options,
    );
  });
}

// ── Health ─────────────────────────────────────────────────────────────────────

/**
 * 健康检查 — GET /health (无需认证)
 *
 * @param account - 已解析 Gotify 账号；只需要 serverUrl。
 * @param options - 可选 fetch/超时/重试参数。
 * @returns 健康状态、耗时和错误摘要。
 */
export async function healthCheck(
  account: ResolvedGotifyAccount,
  options: GotifyFetchOptions = {},
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const start = Date.now();
  try {
    await fetchWithRetry(
      fetchImpl,
      buildAuthUrl(account, "/health", false),
      {},
      { ...options, retryCount: 0 },
    );
    return { ok: true, latencyMs: Date.now() - start };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - start, error: String(error) };
  }
}

// ── Doctor ─────────────────────────────────────────────────────────────────────

/**
 * 生成 doctor 报告，验证 Gotify 服务连通性和配置完整性。
 *
 * @param account - 已解析 Gotify 账号。
 * @param options - 可选 fetch/超时/重试参数。
 * @returns operator 可读的诊断报告。
 */
export async function runGotifyDoctor(
  account: ResolvedGotifyAccount,
  options: GotifyFetchOptions = {},
): Promise<GotifyDoctorReport> {
  const errors: string[] = [];
  let applicationsChecked = false;
  let clientsChecked = false;
  let healthOk = false;

  if (!account.serverUrl) {
    errors.push("Missing serverUrl.");
  }
  if (!account.appToken) {
    errors.push("Missing appToken.");
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

/**
 * 探测账号连通性与 Token 有效性，供 status.probeAccount 使用。
 *
 * 与 `runGotifyDoctor()` 相比，本函数返回更轻量的结构，适合 OpenClaw 渠道状态页
 * 进行周期性探测。
 *
 * @param account - 已解析 Gotify 账号。
 * @param options - 可选 fetch/超时/重试参数。
 * @returns 账号探测结果，包括健康检查和 token 有效性。
 */
export async function probeGotifyAccount(
  account: ResolvedGotifyAccount,
  options: GotifyFetchOptions = {},
): Promise<{
  ok: boolean;
  latencyMs?: number;
  healthOk?: boolean;
  appTokenValid?: boolean;
  clientTokenValid?: boolean;
  error?: string;
}> {
  if (!account.configured) {
    return { ok: false, error: "Missing serverUrl or appToken" };
  }

  const health = await healthCheck(account, options);
  if (!health.ok) {
    return {
      ok: false,
      latencyMs: health.latencyMs,
      healthOk: false,
      error: health.error ?? "Health check failed",
    };
  }

  let appTokenValid: boolean | undefined;
  let clientTokenValid: boolean | undefined;

  if (account.clientToken) {
    try {
      const applications = await listApplications(account, options);
      clientTokenValid = true;
      if (account.appToken) {
        appTokenValid = applications.some(
          (app) => app.token === account.appToken,
        );
      }
    } catch (error) {
      clientTokenValid = false;
      return {
        ok: false,
        latencyMs: health.latencyMs,
        healthOk: true,
        clientTokenValid: false,
        appTokenValid,
        error: String(error),
      };
    }
  }

  const tokenIssue =
    appTokenValid === false
      ? "appToken not found in application list"
      : undefined;

  return {
    ok: !tokenIssue,
    latencyMs: health.latencyMs,
    healthOk: true,
    appTokenValid,
    clientTokenValid,
    error: tokenIssue,
  };
}

// ── 遗留导出（向后兼容） ─────────────────────────────────────────────────────
export { normalizeServerUrl };
