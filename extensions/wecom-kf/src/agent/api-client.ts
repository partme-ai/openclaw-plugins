/**
 * WeCom Agent API 客户端
 * 管理 AccessToken 缓存和 API 调用
 */

import crypto from "node:crypto";
import path from "node:path";
import { API_ENDPOINTS, KF_MEDIA_MAX_BYTES, LIMITS } from "../types/constants.js";
import type { ResolvedAgentAccount } from "../types/index.js";
import { splitUtf8TextByMaxBytes } from "@partme.ai/openclaw-message-sdk/util";
import { readResponseBodyAsBuffer, wecomFetch, type WecomHttpOptions } from "../shared/http.js";
import { resolveWecomEgressProxyUrlFromNetwork } from "../config/index.js";
import { resolveApiBaseUrl } from "../config/kf-routes.js";
import { reserveKfOutboundSend, rollbackKfSendReservation } from "./kf-send-guard.js";
import { stripMarkdown } from "@partme.ai/openclaw-message-sdk/text";
import { needsTranscoding, transcodeBufferToAmr } from "./voice-transcode.js";

/**
 * 按账号 `apiBaseUrl` 构造企微 OpenAPI 绝对 URL（默认官方域名）。
 */
function buildAgentApiUrl(agent: ResolvedAgentAccount, urlOrPath: string): string {
    const base = resolveApiBaseUrl(agent.config);
    if (urlOrPath.startsWith("http://") || urlOrPath.startsWith("https://")) {
        const path = urlOrPath.replace(/^https?:\/\/[^/]+/, "");
        return `${base}${path.startsWith("/") ? path : `/${path}`}`;
    }
    return `${base}${urlOrPath.startsWith("/") ? urlOrPath : `/${urlOrPath}`}`;
}

/**
 * **TokenCache (AccessToken 缓存结构)**
 * 
 * 用于缓存企业微信 API 调用所需的 AccessToken。
 * @property token 缓存的 Token 字符串
 * @property expiresAt 过期时间戳 (ms)
 * @property refreshPromise 当前正在进行的刷新 Promise (防止并发刷新)
 */
type TokenCache = {
    token: string;
    expiresAt: number;
    refreshPromise: Promise<string> | null;
};

const tokenCaches = new Map<string, TokenCache>();
/** 防止动态企业/私有网关配置持续产生新指纹，最终让 token 缓存无界增长。 */
const MAX_TOKEN_CACHE_ENTRIES = 256;
const MAX_JSON_RESPONSE_BYTES = 2 * 1024 * 1024;

/**
 * 把渠道/账号 network 配置收敛成实际 HTTP 参数。
 *
 * retries 表示“首次请求失败后的额外次数”；只有调用方显式声明 retrySafe 时才生效，避免
 * send_msg 在响应丢失场景被重复发送。配置即使绕过 JSON Schema，也必须在运行时 fail-fast。
 */
export function resolveAgentHttpOptions(
    agent: ResolvedAgentAccount,
    retrySafe = false,
): WecomHttpOptions {
    const timeoutMs = agent.network?.timeoutMs ?? LIMITS.REQUEST_TIMEOUT_MS;
    const retries = agent.network?.retries ?? 0;
    const retryDelayMs = agent.network?.retryDelayMs ?? 500;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
        throw new Error("wecom-kf network.timeoutMs must be an integer between 1000 and 120000");
    }
    if (!Number.isInteger(retries) || retries < 0 || retries > 5) {
        throw new Error("wecom-kf network.retries must be an integer between 0 and 5");
    }
    if (!Number.isInteger(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 30_000) {
        throw new Error("wecom-kf network.retryDelayMs must be an integer between 0 and 30000");
    }
    return {
        proxyUrl: resolveWecomEgressProxyUrlFromNetwork(agent.network),
        timeoutMs,
        retrySafe,
        retries: retrySafe ? retries : 0,
        retryDelayMs,
    };
}

/** 外部平台错误只保留单行有限摘要，避免控制字符或超长响应污染 Gateway 日志。 */
function apiFailure(prefix: string, errcode: unknown, errmsg: unknown): Error {
    const safeMessage = String(errmsg ?? "unknown")
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .slice(0, 256);
    return new Error(`${prefix}: ${String(errcode ?? "unknown")} ${safeMessage}`);
}

function trimTokenCaches(): void {
    while (tokenCaches.size > MAX_TOKEN_CACHE_ENTRIES) {
        const oldest = tokenCaches.keys().next().value as string | undefined;
        if (!oldest) return;
        tokenCaches.delete(oldest);
    }
}

/**
 * 生成不暴露凭据明文的 token 缓存键。
 *
 * access_token 由企业 ID、Secret 和实际 API 服务共同决定。把 Secret 与 apiBaseUrl 纳入
 * 指纹，才能在凭据轮换或切换私有化网关后立即获取新 token；相同凭据的多个 KF 账号
 * 仍会共享缓存与并发刷新 Promise。
 */
function buildTokenCacheKey(agent: ResolvedAgentAccount): string {
    return crypto
        .createHash("sha256")
        .update(`${agent.corpId}\0${agent.corpSecret}\0${resolveApiBaseUrl(agent.config)}`)
        .digest("hex");
}

async function readJsonResponse<T>(response: Response): Promise<T> {
    const body = await readResponseBodyAsBuffer(response, MAX_JSON_RESPONSE_BYTES);
    if (!response.ok) {
        throw new Error(`WeCom API HTTP ${response.status}`);
    }
    try {
        return JSON.parse(body.toString("utf8")) as T;
    } catch {
        throw new Error("WeCom API returned invalid JSON");
    }
}

function normalizeUploadFilename(filename: string): string {
    const trimmed = filename.trim();
    if (!trimmed) return "file.bin";
    const ext = trimmed.includes(".") ? `.${trimmed.split(".").pop()!.toLowerCase()}` : "";
    const base = ext ? trimmed.slice(0, -ext.length) : trimmed;
    const sanitizedBase = base
        .replace(/[^\x20-\x7e]/g, "_")
        .replace(/["\\\/;=]/g, "_")
        .replace(/\s+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "");
    const safeBase = sanitizedBase || "file";
    const safeExt = ext.replace(/[^a-z0-9.]/g, "");
    return `${safeBase}${safeExt || ".bin"}`;
}

function guessUploadContentType(filename: string): string {
    const ext = filename.split(".").pop()?.toLowerCase() || "";
    const contentTypeMap: Record<string, string> = {
        // image
        jpg: "image/jpg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", bmp: "image/bmp",
        // audio / video
        amr: "voice/amr", mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", ogg: "audio/ogg", mp4: "video/mp4", mov: "video/quicktime",
        // documents
        txt: "text/plain", md: "text/markdown", csv: "text/csv", tsv: "text/tab-separated-values", json: "application/json",
        xml: "application/xml", yaml: "application/yaml", yml: "application/yaml",
        pdf: "application/pdf", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        rtf: "application/rtf", odt: "application/vnd.oasis.opendocument.text",
        // archives
        zip: "application/zip", rar: "application/vnd.rar", "7z": "application/x-7z-compressed",
        gz: "application/gzip", tgz: "application/gzip", tar: "application/x-tar",
    };
    return contentTypeMap[ext] || "application/octet-stream";
}

/**
 * **getAccessToken (获取 AccessToken)**
 * 
 * 获取企业微信 API 调用所需的 AccessToken。
 * 具备自动缓存和过期刷新机制。
 * 
 * @param agent Agent 账号信息
 * @returns 有效的 AccessToken
 */
export async function getAccessToken(agent: ResolvedAgentAccount): Promise<string> {
    const cacheKey = buildTokenCacheKey(agent);
    let cache = tokenCaches.get(cacheKey);

    if (!cache) {
        cache = { token: "", expiresAt: 0, refreshPromise: null };
        tokenCaches.set(cacheKey, cache);
        trimTokenCaches();
    }

    const now = Date.now();
    if (cache.token && cache.expiresAt > now + LIMITS.TOKEN_REFRESH_BUFFER_MS) {
        return cache.token;
    }

    // 防止并发刷新
    if (cache.refreshPromise) {
        return cache.refreshPromise;
    }

    cache.refreshPromise = (async () => {
        try {
            const url = buildAgentApiUrl(
                agent,
                `${API_ENDPOINTS.GET_TOKEN}?corpid=${encodeURIComponent(agent.corpId)}&corpsecret=${encodeURIComponent(agent.corpSecret)}`,
            );
            const res = await wecomFetch(url, undefined, resolveAgentHttpOptions(agent, true));
            const json = await readJsonResponse<{ access_token?: string; expires_in?: number; errcode?: number; errmsg?: string }>(res);

            if (!json?.access_token) {
                throw apiFailure("gettoken failed", json?.errcode, json?.errmsg);
            }

            cache!.token = json.access_token;
            cache!.expiresAt = Date.now() + (json.expires_in ?? 7200) * 1000;
            return cache!.token;
        } finally {
            cache!.refreshPromise = null;
        }
    })();

    return cache.refreshPromise;
}

/**
 * **uploadMedia (上传媒体文件)**
 * 
 * 上传临时素材到企业微信。
 * 素材有效期为 3 天。
 * 
 * @param params.type 媒体类型 (image, voice, video, file)
 * @param params.buffer 文件二进制数据
 * @param params.filename 文件名 (需包含正确扩展名)
 * @returns 媒体 ID (media_id)
 */
export async function uploadMedia(params: {
    agent: ResolvedAgentAccount;
    type: "image" | "voice" | "video" | "file";
    buffer: Buffer;
    filename: string;
}): Promise<string> {
    const { agent, type, buffer, filename } = params;
    const safeFilename = normalizeUploadFilename(filename);
    const token = await getAccessToken(agent);
    // 添加 debug=1 参数获取更多错误信息
    const url = buildAgentApiUrl(agent, `${API_ENDPOINTS.UPLOAD_MEDIA}?access_token=${encodeURIComponent(token)}&type=${encodeURIComponent(type)}`);

    const uploadOnce = async (fileContentType: string) => {
        // 手动构造 multipart/form-data 请求体
        // 企业微信要求包含 filename 和 filelength
        const boundary = `----WebKitFormBoundary${crypto.randomBytes(16).toString("hex")}`;

        const header = Buffer.from(
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="media"; filename="${safeFilename}"; filelength=${buffer.length}\r\n` +
            `Content-Type: ${fileContentType}\r\n\r\n`
        );
        const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
        const body = Buffer.concat([header, buffer, footer]);

        const res = await wecomFetch(url, {
            method: "POST",
            headers: {
                "Content-Type": `multipart/form-data; boundary=${boundary}`,
                "Content-Length": String(body.length),
            },
            body: body,
        }, resolveAgentHttpOptions(agent));
        const json = await readJsonResponse<{ media_id?: string; errcode?: number; errmsg?: string }>(res);
        return json;
    };

    const preferredContentType = guessUploadContentType(safeFilename);
    let json = await uploadOnce(preferredContentType);

    // 某些文件类型在严格网关/企业微信校验下可能失败，回退到通用类型再试一次。
    if (!json?.media_id && preferredContentType !== "application/octet-stream") {
        console.warn(
            `[wecom-upload] Upload failed with ${preferredContentType}, retrying as application/octet-stream (errcode=${String(json?.errcode ?? "unknown")})`,
        );
        json = await uploadOnce("application/octet-stream");
    }

    if (!json?.media_id) {
        throw apiFailure("upload failed", json?.errcode, json?.errmsg);
    }
    return json.media_id;
}

/**
 * **downloadMedia (下载媒体文件)**
 * 
 * 通过 media_id 从企业微信服务器下载临时素材。
 * 
 * @returns { buffer, contentType }
 */
export async function downloadMedia(params: {
    agent: ResolvedAgentAccount;
    mediaId: string;
    maxBytes?: number;
}): Promise<{ buffer: Buffer; contentType: string; filename?: string }> {
    const { agent, mediaId } = params;
    const token = await getAccessToken(agent);
    const url = buildAgentApiUrl(agent, `${API_ENDPOINTS.DOWNLOAD_MEDIA}?access_token=${encodeURIComponent(token)}&media_id=${encodeURIComponent(mediaId)}`);

    const res = await wecomFetch(url, undefined, resolveAgentHttpOptions(agent, true));

    if (!res.ok) {
        throw new Error(`download failed: ${res.status}`);
    }

    const contentType = res.headers.get("content-type") || "application/octet-stream";
    const disposition = res.headers.get("content-disposition") || "";
    const filename = (() => {
        // 兼容：filename="a.md" / filename=a.md / filename*=UTF-8''a%2Eb.md
        const mStar = disposition.match(/filename\*\s*=\s*([^;]+)/i);
        if (mStar) {
            const raw = mStar[1]!.trim().replace(/^"(.*)"$/, "$1");
            const parts = raw.split("''");
            const encoded = parts.length === 2 ? parts[1]! : raw;
            try {
                return decodeURIComponent(encoded);
            } catch {
                return encoded;
            }
        }
        const m = disposition.match(/filename\s*=\s*([^;]+)/i);
        if (!m) return undefined;
        return m[1]!.trim().replace(/^"(.*)"$/, "$1") || undefined;
    })();

    // 检查是否返回了错误 JSON
    if (contentType.includes("application/json")) {
        const json = await readJsonResponse<{ errcode?: number; errmsg?: string }>(res);
        throw apiFailure("download failed", json?.errcode, json?.errmsg);
    }

    const buffer = await readResponseBodyAsBuffer(res, params.maxBytes);
    return { buffer, contentType, filename };
}

const INVALID_ACCESS_TOKEN_ERRCODES = new Set([40001, 40014, 42001]);

/**
 * **callAuthenticatedJson (带自动重试的认证 API 调用)**
 *
 * 泛型包装器：自动获取 token，token 过期时清缓存重试一次。
 * 避免每个 API 端点手动处理 token 生命周期。
 * 从 research/openclaw-china 回移植。
 */
async function callAuthenticatedJson<T extends { errcode?: number; errmsg?: string }>(
  agent: ResolvedAgentAccount,
  buildPath: (accessToken: string) => string,
  init: Omit<RequestInit, "headers"> & { headers?: Record<string, string> } = {},
  options: { retrySafe?: boolean } = {},
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const accessToken = await getAccessToken(agent);
    const url = buildAgentApiUrl(agent, buildPath(accessToken));
    const res = await wecomFetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    }, resolveAgentHttpOptions(agent, options.retrySafe === true));
    const data = await readJsonResponse<T>(res);

    if (
      attempt === 0 &&
      data.errcode !== undefined &&
      INVALID_ACCESS_TOKEN_ERRCODES.has(data.errcode)
    ) {
      tokenCaches.delete(buildTokenCacheKey(agent));
      continue;
    }

    return data;
  }

  throw new Error("authenticated API call exhausted retries");
}

/** KF sync_msg 单条消息 */
export type KfSyncMsgItem = {
    msgid: string;
    open_kfid?: string;
    external_userid?: string;
    send_time?: number;
    origin?: number;
    servicer_userid?: string;
    msgtype: string;
    [key: string]: unknown;
};

/** KF sync_msg 响应 */
export type KfSyncMsgResponse = {
    errcode: number;
    errmsg: string;
    next_cursor?: string;
    has_more: number;
    msg_list: KfSyncMsgItem[];
};

/**
 * 校验并规范化企业微信 `sync_msg` 响应。
 *
 * 这里不能用 `?? 0` 把缺失的 `errcode` 当成成功：网关、代理或上游协议变化
 * 都可能返回一个合法 JSON 对象，但它并不是企业微信响应。若误判为成功，调用方会
 * 推进持久化游标，造成这一页客服消息永久跳过。
 *
 * 错误响应只要求 `errcode/errmsg`，因为企业微信在失败时通常不会返回分页字段；
 * 成功响应则严格要求分页标记和消息数组，保证游标状态机只消费可信数据。
 */
export function parseKfSyncMsgResponse(data: unknown): KfSyncMsgResponse {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("WeCom sync_msg returned an invalid response object");
    }
    const record = data as Record<string, unknown>;
    if (!Number.isInteger(record.errcode)) {
        throw new Error("WeCom sync_msg response is missing integer errcode");
    }
    if (typeof record.errmsg !== "string") {
        throw new Error("WeCom sync_msg response is missing string errmsg");
    }
    const errcode = record.errcode as number;
    const errmsg = record.errmsg;
    if (errcode !== 0) {
        return { errcode, errmsg, has_more: 0, msg_list: [] };
    }
    if (record.has_more !== 0 && record.has_more !== 1) {
        throw new Error("WeCom sync_msg success response has invalid has_more");
    }
    if (!Array.isArray(record.msg_list)) {
        throw new Error("WeCom sync_msg success response is missing msg_list");
    }
    if (record.next_cursor !== undefined && typeof record.next_cursor !== "string") {
        throw new Error("WeCom sync_msg success response has invalid next_cursor");
    }
    const msgList = record.msg_list.map((item, index) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
            throw new Error(`WeCom sync_msg msg_list[${index}] is not an object`);
        }
        const message = item as Record<string, unknown>;
        if (typeof message.msgid !== "string" || !message.msgid.trim()) {
            throw new Error(`WeCom sync_msg msg_list[${index}] is missing msgid`);
        }
        if (typeof message.msgtype !== "string" || !message.msgtype.trim()) {
            throw new Error(`WeCom sync_msg msg_list[${index}] is missing msgtype`);
        }
        return message as KfSyncMsgItem;
    });
    return {
        errcode,
        errmsg,
        next_cursor: record.next_cursor as string | undefined,
        has_more: record.has_more,
        msg_list: msgList,
    };
}

/** KF send_msg / send_msg_on_event 结果 */
export type KfSendMsgResult = {
    errcode: number;
    errmsg: string;
    msgid?: string;
};

/**
 * **syncKfMessages (客服消息同步 — agent 认证)**
 *
 * POST /cgi-bin/kf/sync_msg
 */
export async function syncKfMessages(
    agent: ResolvedAgentAccount,
    params: {
        cursor?: string;
        token?: string;
        open_kfid?: string;
        limit?: number;
        voice_format?: number;
    },
): Promise<KfSyncMsgResponse> {
    const body: Record<string, unknown> = {};
    if (params.cursor?.trim()) body.cursor = params.cursor.trim();
    if (params.token?.trim()) body.token = params.token.trim();
    if (params.open_kfid?.trim()) body.open_kfid = params.open_kfid.trim();
    if (typeof params.limit === "number") body.limit = params.limit;
    if (typeof params.voice_format === "number") body.voice_format = params.voice_format;

    const data = await callAuthenticatedJson<KfSyncMsgResponse & { has_more?: number; msg_list?: KfSyncMsgItem[] }>(
        agent,
        (accessToken) => `${API_ENDPOINTS.KF_SYNC_MSG}?access_token=${encodeURIComponent(accessToken)}`,
        { method: "POST", body: JSON.stringify(body) },
        { retrySafe: true },
    );

    return parseKfSyncMsgResponse(data);
}

/**
 * **syncMessages (兼容旧签名 — 内部转 syncKfMessages)**
 * @deprecated 优先使用 syncKfMessages(agent, params)
 */
export async function syncMessages(
    accessToken: string,
    cursor: string,
    token?: string,
    openKfId?: string,
    limit = 1000,
): Promise<KfSyncMsgResponse> {
    void accessToken;
    const agent: ResolvedAgentAccount = {
        accountId: "legacy-syncMessages",
        enabled: true,
        configured: true,
        corpId: "",
        corpSecret: "",
        token: "",
        encodingAESKey: "",
        config: { corpId: "", corpSecret: "", token: "", encodingAESKey: "" },
    };
    const url = `${API_ENDPOINTS.KF_SYNC_MSG}?access_token=${encodeURIComponent(accessToken)}`;
    const body: Record<string, unknown> = {};
    if (cursor?.trim()) body.cursor = cursor.trim();
    if (token?.trim()) body.token = token.trim();
    if (openKfId?.trim()) body.open_kfid = openKfId.trim();
    if (typeof limit === "number" && limit > 0) body.limit = limit;

    const res = await wecomFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    }, { timeoutMs: LIMITS.REQUEST_TIMEOUT_MS });
    const json = await readJsonResponse<KfSyncMsgResponse & { has_more?: number; msg_list?: KfSyncMsgItem[] }>(res);
    void agent;
    return parseKfSyncMsgResponse(json);
}

/**
 * **sendKfMessage (发送客服消息 — agent 认证)**
 *
 * POST /cgi-bin/kf/send_msg
 */
export async function sendKfMessage(
    agent: ResolvedAgentAccount,
    params: {
        touser: string;
        open_kfid: string;
        msgtype: string;
        [key: string]: unknown;
    },
): Promise<KfSendMsgResult> {
    const openKfId = String(params.open_kfid ?? "").trim();
    const externalUserId = String(params.touser ?? "").trim();
    const guard = await reserveKfOutboundSend({ openKfId, externalUserId });
    if (!guard.allowed) {
        console.warn(`[wecom-kf] send_msg blocked code=${guard.code}: ${guard.reason}`);
        return { errcode: 95001, errmsg: guard.reason };
    }

    const body: Record<string, unknown> = {
        touser: params.touser,
        open_kfid: params.open_kfid,
        msgtype: params.msgtype,
    };
    for (const [key, value] of Object.entries(params)) {
        if (key !== "touser" && key !== "open_kfid" && key !== "msgtype") {
            body[key] = value;
        }
    }

    try {
        const result = await callAuthenticatedJson<KfSendMsgResult>(
            agent,
            (accessToken) => `${API_ENDPOINTS.KF_SEND_MSG}?access_token=${encodeURIComponent(accessToken)}`,
            { method: "POST", body: JSON.stringify(body) },
        );
        if (result.errcode !== 0) {
            await rollbackKfSendReservation(guard.reservation);
        }
        return result;
    } catch (error) {
        await rollbackKfSendReservation(guard.reservation);
        throw error;
    }
}

/**
 * **sendKfWelcomeMessage (发送事件消息/欢迎语 — agent 认证)**
 *
 * POST /cgi-bin/kf/send_msg_on_event
 */
export async function sendKfWelcomeMessage(
    agent: ResolvedAgentAccount,
    params: {
        code: string;
        msgtype: string;
        open_kfid?: string;
        [key: string]: unknown;
    },
): Promise<KfSendMsgResult> {
    const body: Record<string, unknown> = {
        code: params.code,
        msgtype: params.msgtype,
    };
    if (params.open_kfid?.trim()) body.open_kfid = params.open_kfid.trim();
    for (const [key, value] of Object.entries(params)) {
        if (key !== "code" && key !== "msgtype" && key !== "open_kfid") {
            body[key] = value;
        }
    }

    return callAuthenticatedJson<KfSendMsgResult>(
        agent,
        (accessToken) => `${API_ENDPOINTS.KF_SEND_MSG_ON_EVENT}?access_token=${encodeURIComponent(accessToken)}`,
        { method: "POST", body: JSON.stringify(body) },
    );
}

/** KF 接待人员条目 */
export type KfServicerInfo = {
    userid: string;
    status: number;
    department_id?: number;
};

/** KF 客服账号条目 */
export type KfAccountInfo = {
    open_kfid: string;
    name: string;
    avatar?: string;
    manage_privilege?: number;
};

/**
 * **KF listKfServicers (获取接待人员列表, 94645)**
 *
 * POST /cgi-bin/kf/servicer/list
 */
export async function listKfServicers(params: {
    agent: ResolvedAgentAccount;
    openKfId?: string;
}): Promise<{ errcode: number; errmsg: string; servicer_list?: KfServicerInfo[] }> {
    const body: Record<string, unknown> = {};
    if (params.openKfId?.trim()) body.open_kfid = params.openKfId.trim();

    return callAuthenticatedJson(
        params.agent,
        (accessToken) => `${API_ENDPOINTS.KF_SERVICER_LIST}?access_token=${encodeURIComponent(accessToken)}`,
        { method: "POST", body: JSON.stringify(body) },
        { retrySafe: true },
    );
}

/**
 * **KF listKfAccounts (获取客服账号列表, 94661)**
 *
 * POST /cgi-bin/kf/account/list
 */
export async function listKfAccounts(params: {
    agent: ResolvedAgentAccount;
    offset?: number;
    limit?: number;
}): Promise<{ errcode: number; errmsg: string; account_list?: KfAccountInfo[] }> {
    const body: Record<string, unknown> = {};
    if (typeof params.offset === "number") body.offset = params.offset;
    if (typeof params.limit === "number") body.limit = Math.min(params.limit, 100);

    return callAuthenticatedJson(
        params.agent,
        (accessToken) => `${API_ENDPOINTS.KF_ACCOUNT_LIST}?access_token=${encodeURIComponent(accessToken)}`,
        { method: "POST", body: JSON.stringify(body) },
        { retrySafe: true },
    );
}

/**
 * **KF getKfAccountLink (获取客服账号链接, 94665)**
 *
 * POST /cgi-bin/kf/add_contact_way
 */
export async function getKfAccountLink(params: {
    agent: ResolvedAgentAccount;
    openKfId: string;
    scene?: string;
}): Promise<{ errcode: number; errmsg: string; url?: string }> {
    const body: Record<string, unknown> = { open_kfid: params.openKfId.trim() };
    if (params.scene?.trim()) body.scene = params.scene.trim();

    return callAuthenticatedJson(
        params.agent,
        (accessToken) => `${API_ENDPOINTS.KF_ADD_CONTACT_WAY}?access_token=${encodeURIComponent(accessToken)}`,
        { method: "POST", body: JSON.stringify(body) },
    );
}

/**
 * **KF transferKfSession (分配/转接客服会话, 94669)**
 *
 * POST /cgi-bin/kf/service_state/trans
 */
export async function transferKfSession(params: {
    agent: ResolvedAgentAccount;
    openKfId: string;
    externalUserId: string;
    serviceState: number;
    servicerUserId?: string;
}): Promise<{ errcode: number; errmsg: string; msg_code?: string }> {
    const body: Record<string, unknown> = {
        open_kfid: params.openKfId.trim(),
        external_userid: params.externalUserId.trim(),
        service_state: params.serviceState,
    };
    if (params.servicerUserId?.trim()) body.servicer_userid = params.servicerUserId.trim();

    return callAuthenticatedJson(
        params.agent,
        (accessToken) => `${API_ENDPOINTS.KF_SERVICE_STATE_TRANS}?access_token=${encodeURIComponent(accessToken)}`,
        { method: "POST", body: JSON.stringify(body) },
    );
}

/**
 * **sendKfTextMessage (发送 KF 文本消息，含 Markdown 剥离和自动拆分)**
 *
 * 自动处理 stripMarkdown + splitUtf8TextByMaxBytes + sendKfMessage 完整流程。
 * 从 research/openclaw-china 回移植。
 */
export async function sendKfTextMessage(params: {
  agent: ResolvedAgentAccount;
  externalUserId: string;
  text: string;
  openKfId?: string;
}): Promise<Array<{ errcode: number; errmsg: string; msgid?: string }>> {
  const { agent, externalUserId } = params;
  const openKfId = params.openKfId?.trim();
  if (!openKfId) {
    throw new Error("openKfId not available for text sending");
  }

  const chunks = splitUtf8TextByMaxBytes(stripMarkdown(params.text), LIMITS.TEXT_MAX_BYTES);
  const results: KfSendMsgResult[] = [];

  for (const chunk of chunks) {
    const result = await sendKfMessage(agent, {
      touser: externalUserId,
      open_kfid: openKfId,
      msgtype: "text",
      text: { content: chunk },
    });
    results.push(result);
    if (result.errcode !== 0) {
      break;
    }
  }

  return results;
}

/**
 * **summarizeSendResults (汇总发送结果)**
 *
 * 从批量发送结果中提取成功/失败状态。
 * 从 research/openclaw-china 回移植。
 */
export function summarizeSendResults(
  results: Array<{ errcode: number; errmsg: string; msgid?: string }>,
): { ok: boolean; msgid?: string; error?: string } {
  if (results.length === 0) {
    return { ok: false, error: "no send attempts executed" };
  }

  const failed = results.find((result) => result.errcode !== 0);
  if (failed) {
    return {
      ok: false,
      msgid: failed.msgid,
      error: failed.errmsg || `send failed (errcode=${failed.errcode})`,
    };
  }

  const last = results[results.length - 1];
  return { ok: true, msgid: last?.msgid };
}

/**
 * 根据 MIME / 扩展名推断 KF 媒体类型。
 */
export function inferKfOutboundMediaType(params: {
  contentType?: string;
  filename: string;
}): "image" | "voice" | "video" | "file" {
  const contentType = String(params.contentType ?? "").toLowerCase();
  const ext = path.extname(params.filename).slice(1).toLowerCase();
  if (contentType.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp", "bmp"].includes(ext)) {
    return "image";
  }
  if (
    contentType.startsWith("audio/") ||
    ["amr", "speex", "mp3", "wav", "m4a", "ogg"].includes(ext)
  ) {
    return "voice";
  }
  if (contentType.startsWith("video/") || ["mp4", "mov"].includes(ext)) {
    return "video";
  }
  return "file";
}

/**
 * 上传并通过 KF send_msg 发送单条媒体消息。
 */
export async function sendKfMediaMessage(params: {
  agent: ResolvedAgentAccount;
  externalUserId: string;
  openKfId: string;
  buffer: Buffer;
  filename: string;
  contentType?: string;
  title?: string;
  description?: string;
}): Promise<KfSendMsgResult> {
  const openKfId = params.openKfId.trim();
  const externalUserId = params.externalUserId.trim();
  if (!openKfId || !externalUserId) {
    throw new Error("openKfId and externalUserId are required for KF media send");
  }

  let buffer = params.buffer;
  let filename = params.filename.trim() || "media.bin";
  let mediaType = inferKfOutboundMediaType({ contentType: params.contentType, filename });

  if (mediaType === "voice") {
    const ext = path.extname(filename).slice(1).toLowerCase() || "bin";
    if (needsTranscoding(ext)) {
      buffer = await transcodeBufferToAmr(buffer, ext);
      filename = `${path.basename(filename, path.extname(filename)) || "voice"}.amr`;
      mediaType = "voice";
    }
  }

  const maxBytes = KF_MEDIA_MAX_BYTES[mediaType];
  if (buffer.length > maxBytes) {
    throw new Error(
      `KF ${mediaType} exceeds size limit (${buffer.length} > ${maxBytes} bytes)`,
    );
  }

  const mediaId = await uploadMedia({
    agent: params.agent,
    type: mediaType,
    buffer,
    filename,
  });

  const payload: Record<string, unknown> = {
    touser: externalUserId,
    open_kfid: openKfId,
    msgtype: mediaType,
  };

  if (mediaType === "video") {
    payload.video = {
      media_id: mediaId,
      title: params.title ?? path.basename(filename),
      description: params.description ?? "",
    };
  } else {
    payload[mediaType] = { media_id: mediaId };
  }

  return sendKfMessage(params.agent, payload as {
    touser: string;
    open_kfid: string;
    msgtype: string;
    [key: string]: unknown;
  });
}
