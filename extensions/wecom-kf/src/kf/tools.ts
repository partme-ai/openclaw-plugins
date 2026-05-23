/**
 * KF 客服行为 Tools
 *
 * 基于企微微信客服 API 实现的 Agent Tools：
 * - wecom_kf_servicer_list   — 获取接待人员列表
 * - wecom_kf_account_list    — 获取客服账号列表
 * - wecom_kf_account_link    — 获取客服账号链接
 * - wecom_kf_session_status  — 获取会话状态
 * - wecom_kf_session_transfer — 变更会话状态（转人工/结束等）
 */

import { getAccessToken } from "../agent/api-client.js";
import { API_ENDPOINTS } from "../types/constants.js";
import { wecomFetch } from "../http.js";
import { resolveWecomEgressProxyUrlFromNetwork } from "../config/index.js";

type ToolDef = {
  name: string;
  label: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (id: string, params: Record<string, unknown>) => Promise<{ content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> }>;
};

type ResolvedAgent = {
  accountId: string;
  enabled: boolean;
  configured: boolean;
  corpId: string;
  corpSecret: string;
  token: string;
  encodingAESKey: string;
  config: { corpId: string; corpSecret: string; token: string; encodingAESKey: string };
};

function resolveAgent(config?: Record<string, unknown>): ResolvedAgent {
  const channels = (config?.channels ?? {}) as Record<string, unknown>;
  const wecomKf = (channels["wecom-kf"] ?? {}) as Record<string, unknown>;
  const accounts = (wecomKf.accounts ?? {}) as Record<string, Record<string, unknown>>;
  const defaultAccount = (wecomKf.defaultAccount as string) ?? "default";
  const account = accounts[defaultAccount] ?? {};

  const agentCfg = (account.agent ?? {}) as Record<string, unknown>;
  const kfCfg = (account.kf ?? {}) as Record<string, unknown>;

  const corpId = ((agentCfg.corpId ?? kfCfg?.corpId ?? account.corpId ?? wecomKf.corpId ?? "") as string).trim();
  const corpSecret = ((agentCfg.corpSecret ?? kfCfg?.corpSecret ?? account.corpSecret ?? wecomKf.corpSecret ?? "") as string).trim();

  return {
    accountId: defaultAccount,
    enabled: true,
    configured: Boolean(corpId && corpSecret),
    corpId,
    corpSecret,
    token: "",
    encodingAESKey: "",
    config: { corpId, corpSecret, token: "", encodingAESKey: "" },
  };
}

async function callKfApi<T extends { errcode?: number; errmsg?: string }>(
  agent: ResolvedAgent,
  urlPath: string,
  init: RequestInit = {},
): Promise<T> {
  const token = await getAccessToken(agent);
  const url = `${API_ENDPOINTS.KF_SYNC_MSG.split("/cgi-bin")[0]}/cgi-bin${urlPath}?access_token=${encodeURIComponent(token)}`;
  const res = await wecomFetch(url, init, {
    timeoutMs: 15000,
    proxyUrl: resolveWecomEgressProxyUrlFromNetwork(undefined),
  });
  return (await res.json()) as T;
}

function textResult(text: string): { content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> } {
  return { content: [{ type: "text", text }], details: {} };
}

// ── Tool implementations ──

async function servicerList(
  params: Record<string, unknown>,
  ctx: { config?: Record<string, unknown> },
): Promise<string> {
  const agent = resolveAgent(ctx.config);
  const openKfId = (params.open_kfid as string)?.trim() || "";
  const data = await callKfApi<{
    errcode: number; errmsg: string;
    servicer_list?: Array<{ userid: string; status: number; department_id?: number }>;
  }>(agent, `/kf/servicer/list&open_kfid=${encodeURIComponent(openKfId)}`);
  if (data.errcode !== 0) return `获取接待人员列表失败: ${data.errmsg} (errcode=${data.errcode})`;
  const list = data.servicer_list ?? [];
  if (list.length === 0) return "该客服账号暂无接待人员";
  const labels: Record<number, string> = { 0: "接待中", 1: "停止接待" };
  return `接待人员列表 (${list.length}):\n${list.map((s) => s.department_id ? `- 部门 ID: ${s.department_id}` : `- ${s.userid}: ${labels[s.status] ?? s.status}`).join("\n")}`;
}

async function accountList(
  params: Record<string, unknown>,
  ctx: { config?: Record<string, unknown> },
): Promise<string> {
  const agent = resolveAgent(ctx.config);
  const body: Record<string, unknown> = {};
  if (typeof params.offset === "number") body.offset = params.offset;
  if (typeof params.limit === "number") body.limit = Math.min(params.limit as number, 100);
  const data = await callKfApi<{
    errcode: number; errmsg: string;
    account_list?: Array<{ open_kfid: string; name: string; avatar: string }>;
  }>(agent, "/kf/account/list", { method: "POST", body: JSON.stringify(body) });
  if (data.errcode !== 0) return `获取客服账号列表失败: ${data.errmsg} (errcode=${data.errcode})`;
  const list = data.account_list ?? [];
  if (list.length === 0) return "暂无客服账号";
  return `客服账号列表 (${list.length}):\n${list.map((a) => `- ${a.name} (open_kfid: ${a.open_kfid})`).join("\n")}`;
}

async function accountLink(
  params: Record<string, unknown>,
  ctx: { config?: Record<string, unknown> },
): Promise<string> {
  const agent = resolveAgent(ctx.config);
  const body: Record<string, unknown> = { open_kfid: (params.open_kfid as string)?.trim() || "" };
  if ((params.scene as string)?.trim()) body.scene = (params.scene as string).trim();
  const data = await callKfApi<{ errcode: number; errmsg: string; url?: string }>(
    agent, "/kf/add_contact_way", { method: "POST", body: JSON.stringify(body) });
  if (data.errcode !== 0) return `获取客服链接失败: ${data.errmsg} (errcode=${data.errcode})`;
  return `客服链接: ${data.url ?? "无"}`;
}

async function sessionStatus(
  params: Record<string, unknown>,
  ctx: { config?: Record<string, unknown> },
): Promise<string> {
  const agent = resolveAgent(ctx.config);
  const data = await callKfApi<{
    errcode: number; errmsg: string; service_state?: number; servicer_userid?: string;
  }>(agent, "/kf/service_state/get", {
    method: "POST",
    body: JSON.stringify({ open_kfid: params.open_kfid, external_userid: params.external_userid }),
  });
  if (data.errcode !== 0) return `获取会话状态失败: ${data.errmsg} (errcode=${data.errcode})`;
  const labels: Record<number, string> = { 0: "未处理", 1: "由智能助手接待", 2: "待接入池排队中", 3: "由人工接待", 4: "已结束" };
  const state = data.service_state ?? -1;
  const servicer = data.servicer_userid ? ` (接待人员: ${data.servicer_userid})` : "";
  return `会话状态: ${labels[state] ?? `未知(${state})`}${servicer}`;
}

async function sessionTransfer(
  params: Record<string, unknown>,
  ctx: { config?: Record<string, unknown> },
): Promise<string> {
  const agent = resolveAgent(ctx.config);
  const serviceState = params.service_state as number;
  if (serviceState === 3 && !(params.servicer_userid as string)?.trim()) {
    return "转人工(state=3)时必须提供 servicer_userid";
  }
  const body: Record<string, unknown> = {
    open_kfid: params.open_kfid,
    external_userid: params.external_userid,
    service_state: serviceState,
  };
  if ((params.servicer_userid as string)?.trim()) body.servicer_userid = (params.servicer_userid as string).trim();
  const data = await callKfApi<{ errcode: number; errmsg: string; msg_code?: string }>(
    agent, "/kf/service_state/trans", { method: "POST", body: JSON.stringify(body) });
  if (data.errcode !== 0) return `变更会话状态失败: ${data.errmsg} (errcode=${data.errcode})`;
  const labels: Record<number, string> = { 1: "由智能助手接待", 2: "待接入池排队中", 3: "已转接至人工", 4: "已结束会话" };
  const msgCode = data.msg_code ? ` (msg_code: ${data.msg_code})` : "";
  return `会话状态已变更: ${labels[serviceState] ?? `状态 ${serviceState}`}${msgCode}`;
}

// ── Tool factory functions ──

export function createKfServicerListTool(): ToolDef {
  return {
    name: "wecom_kf_servicer_list",
    label: "获取接待人员列表",
    description: "获取微信客服账号的接待人员列表，查看哪些人工坐席可接待。返回 userid 和状态（0=接待中, 1=停止接待）。",
    parameters: {
      type: "object" as const,
      properties: {
        open_kfid: { type: "string", description: "客服账号 ID，不填则使用默认账号" },
      },
    },
    async execute(_id: string, params: Record<string, unknown>) {
      return textResult(await servicerList(params, {}));
    },
  };
}

export function createKfAccountListTool(): ToolDef {
  return {
    name: "wecom_kf_account_list",
    label: "获取客服账号列表",
    description: "获取企业微信客服账号列表，包含客服名称和头像。支持分页查询（offset/limit）。",
    parameters: {
      type: "object" as const,
      properties: {
        offset: { type: "number", description: "分页偏移量，默认 0" },
        limit: { type: "number", description: "每页数量，默认 100，最大 100" },
      },
    },
    async execute(_id: string, params: Record<string, unknown>) {
      return textResult(await accountList(params, {}));
    },
  };
}

export function createKfAccountLinkTool(): ToolDef {
  return {
    name: "wecom_kf_account_link",
    label: "获取客服账号链接",
    description: "获取微信客服账号的咨询链接。可指定 scene 场景值用于追踪咨询来源（不多于32字节）。用户点击链接即可发起客服咨询。",
    parameters: {
      type: "object" as const,
      properties: {
        open_kfid: { type: "string", description: "客服账号 ID，不填则使用默认账号" },
        scene: { type: "string", description: "场景值，自定义标识，不多于 32 字节，支持 [0-9a-zA-Z_-]" },
      },
    },
    async execute(_id: string, params: Record<string, unknown>) {
      return textResult(await accountLink(params, {}));
    },
  };
}

export function createKfSessionStatusTool(): ToolDef {
  return {
    name: "wecom_kf_session_status",
    label: "获取会话状态",
    description: "查询微信客户与客服的当前会话状态。0=未处理, 1=智能助手接待中, 2=待接入池排队, 3=人工接待中, 4=已结束。",
    parameters: {
      type: "object" as const,
      properties: {
        open_kfid: { type: "string", description: "客服账号 ID" },
        external_userid: { type: "string", description: "微信客户的 external_userid" },
      },
      required: ["open_kfid", "external_userid"],
    },
    async execute(_id: string, params: Record<string, unknown>) {
      return textResult(await sessionStatus(params, {}));
    },
  };
}

export function createKfSessionTransferTool(): ToolDef {
  return {
    name: "wecom_kf_session_transfer",
    label: "变更会话状态",
    description: "变更客服会话状态：转人工(service_state=3,需指定servicer_userid)、转智能助手(1)、转待接入池(2)、结束会话(4)。",
    parameters: {
      type: "object" as const,
      properties: {
        open_kfid: { type: "string", description: "客服账号 ID" },
        external_userid: { type: "string", description: "微信客户的 external_userid" },
        service_state: { type: "number", description: "目标状态：1=智能助手, 2=待接入池排队, 3=人工接待(转人工), 4=结束会话" },
        servicer_userid: { type: "string", description: "接待人员 userid，转人工(state=3)时必填" },
      },
      required: ["open_kfid", "external_userid", "service_state"],
    },
    async execute(_id: string, params: Record<string, unknown>) {
      return textResult(await sessionTransfer(params, {}));
    },
  };
}
