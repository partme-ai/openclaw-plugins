/**
 * @file Gotify outbound adapter — Host → Gotify REST `POST /message`。
 *
 * @description 把 OpenClaw `ChannelOutboundContext` 经由 mapper 转成 payload，
 * 补齐默认 priority，成功后缓存 `appid`、刷新账号快照 outbound 时间，
 * **写 extras.openclaw.outbound** 切断 `/stream` 闭环。
 * **模块角色**：Channel Plugin · Host-initiated delivery。
 */

import type {
  ChannelOutboundAdapter,
  ChannelOutboundContext,
} from "openclaw/plugin-sdk/channel-contract";

import {
  resolveDefaultGotifyAccountId,
  resolveGotifyAccount,
} from "./config.js";
import { sendGotifyMessage } from "./transport/gotify-api.js";
import { mapOutboundToGotify } from "./dispatch/routing/message-mapper.js";
import { patchAccountSnapshot, setOwnApplicationId } from "./runtime.js";

/**
 * Gotify 出站适配器。
 *
 * 该对象被 ChannelPlugin 暴露给 OpenClaw 宿主，宿主调用 `sendText()` 时，
 * 插件完成账号选择、payload 映射、HTTP 投递和运行态快照更新。
 */
export const gotifyOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  /**
   * 发送纯文本消息至 Gotify Message API（Application token）。
   *
   * @description 包含账号挑选、payload 映射、HTTP 发送、运行态写回。
   * @param ctx - OpenClaw 渠道出站上下文。
   * @returns `{ channel, messageId, accountId }` 投递收据。
   * @throws GotifyApiError —— HTTP 非 2xx（由底层 `sendGotifyMessage` 抛出）。
   * @throws GotifyConnectionError —— 网络不可用或重试耗尽。
   * @throws GotifyTimeoutError —— Abort 超时。
   * @throws GotifyConfigError —— 账号缺少 `serverUrl` / `appToken`。
   */
  async sendText(ctx: ChannelOutboundContext) {
    const accountId = selectAccountId(ctx);
    const account = resolveGotifyAccount(ctx.cfg, accountId);
    const payload = mapOutboundToGotify(ctx);
    const response = await sendGotifyMessage(account, {
      ...payload,
      priority:
        typeof payload.priority === "number"
          ? payload.priority
          : account.defaultPriority,
    });

    if (response.appid !== undefined && response.appid !== null) {
      setOwnApplicationId(account.accountId, response.appid);
    }

    patchAccountSnapshot(account.accountId, {
      lastOutboundAt: Date.now(),
      lastError: null,
    });

    return {
      channel: "gotify",
      messageId: String(response.id),
      accountId: account.accountId,
    };
  },
};

/**
 * 推导本轮出站应绑定账号。
 *
 * @description 优先级：`explicit accountId` > `gotify:<id>`/`裸 id` > `resolveDefaultGotifyAccountId`；
 * `ctx.to` 中含空格或 `/` 视作非账号 token，忽略直达默认账号。
 *
 * @param ctx - Partial outbound context（仅需 cfg/accountId/to）。
 * @returns OpenClaw `accountId` key。
 */
export function selectAccountId(
  ctx: Pick<ChannelOutboundContext, "cfg" | "accountId" | "to">,
): string {
  const explicit = ctx.accountId?.trim();
  if (explicit) {
    return explicit;
  }
  const target = ctx.to.trim();
  if (target && !target.includes(" ") && !target.includes("/")) {
    return (
      target.replace(/^gotify:/i, "").trim() ||
      resolveDefaultGotifyAccountId(ctx.cfg)
    );
  }
  return resolveDefaultGotifyAccountId(ctx.cfg);
}
