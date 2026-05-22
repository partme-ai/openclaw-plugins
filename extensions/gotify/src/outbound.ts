import type {
  ChannelOutboundAdapter,
  ChannelOutboundContext,
} from 'openclaw/plugin-sdk/channel-contract';

import { resolveDefaultGotifyAccountId, resolveGotifyAccount } from './config.js';
import { sendGotifyMessage } from './transport/gotify-api.js';
import { mapOutboundToGotify } from './routing/message-mapper.js';
import { patchAccountSnapshot, setOwnApplicationId } from './runtime.js';

/**
 * Gotify 出站适配器。
 */
export const gotifyOutbound: ChannelOutboundAdapter = {
  deliveryMode: 'direct',
  /**
   * 发送纯文本消息到 Gotify Message API。
   */
  async sendText(ctx: ChannelOutboundContext) {
    const accountId = selectAccountId(ctx);
    const account = resolveGotifyAccount(ctx.cfg, accountId);
    const payload = mapOutboundToGotify(ctx);
    const response = await sendGotifyMessage(account, {
      ...payload,
      priority: typeof payload.priority === 'number' ? payload.priority : account.defaultPriority,
    });

    if (response.appid !== undefined && response.appid !== null) {
      setOwnApplicationId(account.accountId, response.appid);
    }

    patchAccountSnapshot(account.accountId, {
      lastOutboundAt: Date.now(),
      lastError: null,
    });

    return {
      channel: 'gotify',
      messageId: String(response.id),
      accountId: account.accountId,
    };
  },
};

/**
 * 解析本次发送应走的 Gotify 账号。
 */
export function selectAccountId(
  ctx: Pick<ChannelOutboundContext, 'cfg' | 'accountId' | 'to'>
): string {
  const explicit = ctx.accountId?.trim();
  if (explicit) {
    return explicit;
  }
  const target = ctx.to.trim();
  if (target && !target.includes(' ') && !target.includes('/')) {
    return target.replace(/^gotify:/i, '').trim() || resolveDefaultGotifyAccountId(ctx.cfg);
  }
  return resolveDefaultGotifyAccountId(ctx.cfg);
}
