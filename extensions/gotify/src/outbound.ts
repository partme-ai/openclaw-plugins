/**
 * Gotify Outbound — 出站消息适配器。
 *
 * 将 OpenClaw 出站消息映射为 Gotify POST /message 请求，
 * 自动注入 openclaw extras 标记以防止 WebSocket 回环。
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
   * 发送纯文本消息到 Gotify Message API。
   *
   * @param ctx - OpenClaw 渠道出站上下文，包含配置、目标账号/地址和消息正文。
   * @returns 渠道投递回执，包含 Gotify messageId 与实际使用的 accountId。
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
 * 解析本次发送应走的 Gotify 账号。
 *
 * 选择优先级为：
 * 1. `ctx.accountId`
 * 2. `ctx.to` 中的 `gotify:<accountId>` 或裸 accountId
 * 3. 配置中的默认账号
 *
 * @param ctx - 出站上下文的账号选择字段。
 * @returns 需要用于 `resolveGotifyAccount()` 的账号 ID。
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
