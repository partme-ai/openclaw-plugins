/**
 * 企微微信客服 API 封装
 * 仅客服能力，对应官方文档：94670/94677/95122/97712/94645/94661/94665/94669
 * 与 wecom 插件 agent/api-client 职责对齐
 */

import type {
  SyncMsgResponse,
  KfAccount,
  ServicerInfo,
} from "../types/index.js";

/** 企微 API 基础 URL */
const WECOM_API_BASE = "https://qyapi.weixin.qq.com/cgi-bin";

/** access_token 缓存 */
interface TokenCache {
  token: string;
  expiresAt: number;
}

const tokenCacheMap = new Map<string, TokenCache>();

/**
 * 获取企微 access_token
 * 缓存有效期内直接返回，过期自动刷新
 */
export async function getAccessToken(
  corpId: string,
  corpSecret: string
): Promise<string> {
  const cacheKey = `${corpId}:${corpSecret}`;
  const cached = tokenCacheMap.get(cacheKey);

  if (cached && cached.expiresAt > Date.now() + 300_000) {
    return cached.token;
  }

  const res = await fetch(
    `${WECOM_API_BASE}/gettoken?corpid=${corpId}&corpsecret=${corpSecret}`
  );
  const data = (await res.json()) as {
    errcode: number;
    errmsg: string;
    access_token: string;
    expires_in: number;
  };

  if (data.errcode !== 0) {
    throw new Error(`[wecom_kf] Failed to get access_token: ${data.errmsg}`);
  }

  tokenCacheMap.set(cacheKey, {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  });

  return data.access_token;
}

/**
 * 拉取客服消息（sync_msg）
 * Token 有效期 10 分钟，next_cursor 需持久化，以 has_more 为准
 */
export async function syncMessages(
  accessToken: string,
  cursor: string,
  token?: string,
  openKfId?: string
): Promise<SyncMsgResponse> {
  const body: Record<string, unknown> = {
    cursor,
    limit: 1000,
    voice_format: 0,
  };
  if (token) body.token = token;
  if (openKfId) body.open_kfid = openKfId;

  const res = await fetch(
    `${WECOM_API_BASE}/kf/sync_msg?access_token=${accessToken}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  return (await res.json()) as SyncMsgResponse;
}

/**
 * 发送客服消息
 * 48 小时内可回复，每次最多 5 条（客户每发一条重置计数）
 */
export async function sendMessage(
  accessToken: string,
  toUser: string,
  openKfId: string,
  msgtype: string,
  content: Record<string, unknown>
): Promise<{ errcode: number; errmsg: string; msgid?: string }> {
  const body: Record<string, unknown> = {
    touser: toUser,
    open_kfid: openKfId,
    msgtype,
    ...content,
  };

  const res = await fetch(
    `${WECOM_API_BASE}/kf/send_msg?access_token=${accessToken}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  return (await res.json()) as { errcode: number; errmsg: string; msgid?: string };
}

/**
 * 发送事件响应消息（欢迎语、结束语、满意度等）
 * welcome_code 有效期仅 20 秒
 */
export async function sendEventMessage(
  accessToken: string,
  code: string,
  msgtype: string,
  content: Record<string, unknown>
): Promise<{ errcode: number; errmsg: string; msgid?: string }> {
  const body: Record<string, unknown> = {
    code,
    msgtype,
    ...content,
  };

  const res = await fetch(
    `${WECOM_API_BASE}/kf/send_msg_on_event?access_token=${accessToken}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  return (await res.json()) as { errcode: number; errmsg: string; msgid?: string };
}

/**
 * 获取会话状态
 */
export async function getServiceState(
  accessToken: string,
  openKfId: string,
  externalUserId: string
): Promise<{ service_state: number; servicer_userid?: string }> {
  const res = await fetch(
    `${WECOM_API_BASE}/kf/service_state/get?access_token=${accessToken}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        open_kfid: openKfId,
        external_userid: externalUserId,
      }),
    }
  );

  return (await res.json()) as { service_state: number; servicer_userid?: string };
}

/**
 * 变更会话状态
 * 0→1 AI 接管 / 1→2 排队 / 1→3 转坐席
 */
export async function transServiceState(
  accessToken: string,
  openKfId: string,
  externalUserId: string,
  serviceState: number,
  servicerUserId?: string
): Promise<{ errcode: number; errmsg: string; msg_code?: string }> {
  const body: Record<string, unknown> = {
    open_kfid: openKfId,
    external_userid: externalUserId,
    service_state: serviceState,
  };
  if (servicerUserId) {
    body.servicer_userid = servicerUserId;
  }

  const res = await fetch(
    `${WECOM_API_BASE}/kf/service_state/trans?access_token=${accessToken}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  return (await res.json()) as { errcode: number; errmsg: string; msg_code?: string };
}

/**
 * 获取客服账号列表（分页）
 */
export async function listKfAccounts(
  accessToken: string
): Promise<KfAccount[]> {
  const accounts: KfAccount[] = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const res = await fetch(
      `${WECOM_API_BASE}/kf/account/list?access_token=${accessToken}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offset, limit }),
      }
    );

    const data = (await res.json()) as {
      errcode: number;
      errmsg: string;
      account_list: KfAccount[];
    };
    if (data.errcode !== 0) {
      throw new Error(`[wecom_kf] Failed to list KF accounts: ${data.errmsg}`);
    }

    accounts.push(...data.account_list);
    if (data.account_list.length < limit) break;
    offset += limit;
  }

  return accounts;
}

/**
 * 获取接待人员列表
 * status=0 接待中、status=1 停止接待
 */
export async function listServicers(
  accessToken: string,
  openKfId: string
): Promise<ServicerInfo[]> {
  const res = await fetch(
    `${WECOM_API_BASE}/kf/servicer/list?access_token=${accessToken}&open_kfid=${openKfId}`
  );

  const data = (await res.json()) as {
    errcode: number;
    errmsg: string;
    servicer_list: ServicerInfo[];
  };
  if (data.errcode !== 0) {
    throw new Error(`[wecom_kf] Failed to list servicers: ${data.errmsg}`);
  }

  return data.servicer_list ?? [];
}

/**
 * 生成客服链接（文档 94665）
 */
export async function getContactWayUrl(
  accessToken: string,
  openKfId: string,
  scene: string,
  sceneParam?: string
): Promise<string> {
  const body: Record<string, unknown> = {
    open_kfid: openKfId,
    scene,
  };
  if (sceneParam) body.scene_param = sceneParam;

  const res = await fetch(
    `${WECOM_API_BASE}/kf/add_contact_way?access_token=${accessToken}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  const data = (await res.json()) as {
    errcode: number;
    errmsg: string;
    url: string;
  };

  if (data.errcode !== 0) {
    throw new Error(`[wecom_kf] Failed to get contact way: ${data.errmsg}`);
  }

  return data.url;
}
