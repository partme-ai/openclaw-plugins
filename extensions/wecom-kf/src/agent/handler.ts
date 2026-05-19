/**
 * 客户消息处理器
 * 接收客户消息 → OpenClaw reply 管线 → Agent 回复 → kf/send_msg 回写
 * 与 wecom 插件 agent/handler 职责对齐
 */

import type { KfMessage, WecomAccountConfig } from "../types/index.js";
import { getWecomKfRuntime } from "../runtime.js";
import {
  getAccessToken,
  getServiceState,
  transServiceState,
  sendMessage,
} from "./api-client.js";

/**
 * 处理客户消息
 * 客户发送的消息（origin=3）进入此函数
 *
 * @param msg - 企微客服消息
 * @param accountConfig - 对应客服账号的配置
 */
export async function handleCustomerMessage(
  msg: KfMessage,
  accountConfig: WecomAccountConfig
): Promise<void> {
  const runtime = getWecomKfRuntime();
  const { open_kfid, external_userid } = msg;
  const accessToken = await getAccessToken(
    accountConfig.corpId,
    accountConfig.corpSecret
  );

  // 1. 新会话自动接管：state=0 → state=1（智能助手接待）
  try {
    const stateInfo = await getServiceState(
      accessToken,
      open_kfid,
      external_userid
    );
    if (stateInfo.service_state === 0) {
      await transServiceState(accessToken, open_kfid, external_userid, 1);
      console.log(
        `[wecom_kf] Auto-accepted session: ${external_userid} → state=1`
      );
    }

    if (stateInfo.service_state === 3) {
      console.log(
        `[wecom_kf] Session ${external_userid} is in human service, skipping AI`
      );
      return;
    }
  } catch (error) {
    console.error(
      `[wecom_kf] Failed to check/update service state:`,
      error
    );
  }

  // 2. 提取消息文本内容
  const text = extractTextContent(msg);
  if (!text) {
    console.log(`[wecom_kf] Non-text message from ${external_userid}, type: ${msg.msgtype}`);
    return;
  }

  // 3. 走 OpenClaw reply 管线
  const cfg = runtime.config;

  try {
    const route = await runtime.channel.routing.resolveAgentRoute({
      cfg,
      channel: "wecom-kf",
      accountId: open_kfid,
      peer: { kind: "dm", id: external_userid },
    });

    const inboundCtx = await runtime.channel.reply.finalizeInboundContext({
      channel: "wecom-kf",
      accountId: open_kfid,
      from: external_userid,
      text,
      chatType: "direct",
      extra: {},
    });

    const dispatcher = runtime.channel.reply.createReplyDispatcherWithTyping({
      deliver: async (payload) => {
        await sendMessage(
          accessToken,
          external_userid,
          open_kfid,
          "text",
          { text: { content: payload.text } }
        );
      },
    });

    await runtime.channel.reply.dispatchReplyFromConfig({
      ctx: inboundCtx,
      cfg,
      dispatcher,
      replyOptions: route,
    });
  } catch (error) {
    console.error(
      `[wecom_kf] Failed to dispatch reply for ${external_userid}:`,
      error
    );

    try {
      await sendMessage(accessToken, external_userid, open_kfid, "text", {
        text: { content: "抱歉，我遇到了一点技术问题，请稍后再试或输入「转人工」联系人工客服。" },
      });
    } catch {
      // 静默失败
    }
  }
}

/**
 * 从企微消息中提取文本内容
 * 支持 text、image、voice、location、link、miniprogram 等
 */
function extractTextContent(msg: KfMessage): string | null {
  switch (msg.msgtype) {
    case "text":
      return msg.text?.content ?? null;

    case "image": {
      const imageUrl = msg.image?.media_id
        ? `[图片] media_id=${msg.image.media_id}`
        : null;
      return imageUrl;
    }

    case "voice": {
      return msg.voice?.media_id
        ? `[语音] media_id=${msg.voice.media_id}`
        : null;
    }

    case "location": {
      const loc = msg.location;
      if (loc) {
        const parts = [`[位置]`];
        if (loc.name) parts.push(loc.name);
        if (loc.address) parts.push(loc.address);
        if (loc.latitude && loc.longitude) {
          parts.push(`(${loc.latitude}, ${loc.longitude})`);
        }
        return parts.join(" ");
      }
      return null;
    }

    case "link": {
      const link = msg.link;
      if (link) {
        const title = link.title ?? "链接";
        const url = link.url ?? "";
        const desc = link.desc ? ` - ${link.desc}` : "";
        return `[链接] ${title}${desc} ${url}`;
      }
      return null;
    }

    case "miniprogram": {
      const mini = msg.miniprogram;
      if (mini) {
        return `[小程序] ${mini.title ?? "小程序"}`;
      }
      return null;
    }

    case "video":
      return msg.video?.media_id
        ? `[视频] media_id=${msg.video.media_id}`
        : null;

    case "file":
      return msg.file?.media_id
        ? `[文件] media_id=${msg.file.media_id}`
        : null;

    case "event":
      return null;

    default:
      console.log(`[wecom_kf] Unsupported message type: ${msg.msgtype}`);
      return null;
  }
}
