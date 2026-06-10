/**
 * @module ingress/dm-policy
 *
 * 通道无关的 DM（私聊）访问控制。
 *
 * **职责**：根据 `dmPolicy`（open / allowlist / pairing / disabled）判定私聊消息是否放行；
 * pairing 模式下创建配对请求并由插件注入 `sendPairingReply` 下发配对码。
 *
 * **适用场景**：WeCom / Feishu 等 IM 插件在入站链路中，于群聊策略之后、Agent 路由之前调用。
 *
 * **上下游**：
 * - 上游：`group-policy.isSenderInAllowlist`（合并 config + pairing store 白名单）
 * - 下游：OpenClaw pairing 存储（`readPairingAllowFrom` / `upsertPairingRequest`）
 *
 * **关键导出**：`checkChannelDmPolicy`、`DmPolicyMode`、`ReadPairingAllowFrom`
 */

import { isSenderInAllowlist } from "./group-policy.js";

/** DM 策略模式 */
export type DmPolicyMode = "open" | "allowlist" | "pairing" | "disabled";

/** DM 策略检查结果 */
export interface DmPolicyCheckResult {
  /** 是否允许继续处理私聊消息 */
  allowed: boolean;
  /** pairing 模式下是否已下发配对码（仅 created=true 时） */
  pairingSent?: boolean;
}

type RuntimeLog = {
  log?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
};

/** OpenClaw pairing 存储读取 */
export type ReadPairingAllowFrom = (params: {
  channelId: string;
  accountId: string;
}) => Promise<string[]>;

/** OpenClaw pairing 请求 upsert */
export type UpsertPairingRequest = (params: {
  channelId: string;
  senderId: string;
  accountId: string;
}) => Promise<{ code: string; created: boolean }>;

/** 插件注入的 pairing 回复发送 */
export type SendPairingReply = (params: {
  senderId: string;
  accountId: string;
  code: string;
}) => Promise<void>;

/**
 * 检查 DM Policy 访问控制。
 *
 * @param params.channelId - 渠道 ID（用于 pairing 存储与 allowlist 前缀匹配）
 * @param params.senderId - 发送者 ID
 * @param params.isGroup - 是否为群聊（群聊始终放行）
 * @param params.accountId - 账号 ID
 * @param params.dmPolicy - DM 策略，默认 `open`
 * @param params.configAllowFrom - 配置级 allowFrom 白名单
 * @param params.readPairingAllowFrom - 读取 OpenClaw pairing 存储
 * @param params.upsertPairingRequest - pairing 模式下创建/更新配对请求
 * @param params.sendPairingReply - pairing 模式下发送配对码回复
 * @param params.runtime - 日志运行时
 * @param params.logPrefix - 日志前缀，默认 `[{channelId}]`
 * @returns 是否允许私聊；pairing 模式下可能附带 `pairingSent`
 */
export async function checkChannelDmPolicy(params: {
  channelId: string;
  senderId: string;
  isGroup: boolean;
  accountId: string;
  dmPolicy?: DmPolicyMode;
  configAllowFrom?: Array<string | number>;
  readPairingAllowFrom: ReadPairingAllowFrom;
  upsertPairingRequest?: UpsertPairingRequest;
  sendPairingReply?: SendPairingReply;
  runtime: RuntimeLog;
  logPrefix?: string;
}): Promise<DmPolicyCheckResult> {
  const {
    channelId,
    senderId,
    isGroup,
    accountId,
    readPairingAllowFrom,
    upsertPairingRequest,
    sendPairingReply,
    runtime,
  } = params;
  const logPrefix = params.logPrefix ?? `[${channelId}]`;

  if (isGroup) {
    return { allowed: true };
  }

  const dmPolicy = params.dmPolicy ?? "open";
  const configAllowFrom = (params.configAllowFrom ?? []).map((v) => String(v));

  if (dmPolicy === "disabled") {
    runtime.log?.(`${logPrefix} Blocked DM from ${senderId} (dmPolicy=disabled)`);
    return { allowed: false };
  }

  if (dmPolicy === "open") {
    return { allowed: true };
  }

  const storeAllowFrom = await readPairingAllowFrom({ channelId, accountId });
  const effectiveAllowFrom = [...configAllowFrom, ...storeAllowFrom];
  const senderAllowedResult = isSenderInAllowlist(senderId, effectiveAllowFrom, channelId);

  if (senderAllowedResult) {
    return { allowed: true };
  }

  // pairing 模式：未授权发送者触发配对流程，下发配对码后仍拒绝本次消息
  if (dmPolicy === "pairing") {
    if (!upsertPairingRequest) {
      runtime.log?.(`${logPrefix} Pairing required but upsertPairingRequest not configured`);
      return { allowed: false };
    }

    const { code, created } = await upsertPairingRequest({
      channelId,
      senderId,
      accountId,
    });

    if (created) {
      runtime.log?.(`${logPrefix} Pairing request created for sender=${senderId}`);
      if (sendPairingReply) {
        try {
          await sendPairingReply({ senderId, accountId, code });
        } catch (err) {
          runtime.error?.(`${logPrefix} Failed to send pairing reply to ${senderId}: ${String(err)}`);
        }
      }
    } else {
      runtime.log?.(`${logPrefix} Pairing request already exists for sender=${senderId}`);
    }
    return { allowed: false, pairingSent: created };
  }

  runtime.log?.(`${logPrefix} Blocked unauthorized sender ${senderId} (dmPolicy=${dmPolicy})`);
  return { allowed: false };
}
