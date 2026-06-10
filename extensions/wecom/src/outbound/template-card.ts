/**
 * @module outbound/template-card
 *
 * 企微 **template_card** 交互卡片出站（Webhook response_url 协议层）。
 *
 * **职责**：
 * - 检测 Agent 输出中的 template_card JSON
 * - 单聊且有 active response_url 时 POST 发送卡片
 * - 群聊或无 URL 时降级为 Markdown 文本摘要
 */

import type { WecomWebhookTarget } from "../webhook/types.js";
import { REQUEST_TIMEOUT_MS } from "../webhook/types.js";
import { wecomFetch } from "../webhook/http.js";
import { getActiveReplyUrl, useActiveReplyOnce } from "../webhook/active-reply.js";
import { resolveWecomTemplates } from "../config/templates.js";

export type TemplateCardDeliverParams = {
  target: WecomWebhookTarget;
  streamId: string;
  chatType: string;
  trimmedText: string;
  streamStore: {
    getStream: (id: string) => { finished?: boolean; content?: string } | undefined;
    updateStream: (id: string, fn: (s: { finished?: boolean; content?: string }) => void) => void;
  };
};

export type TemplateCardDeliverResult =
  | { handled: true }
  | { handled: false; fallbackText?: string };

/**
 * 若文本为 template_card JSON，经 response_url 发送或降级为 Markdown 文案。
 */
export async function deliverTemplateCardIfPresent(
  params: TemplateCardDeliverParams,
): Promise<TemplateCardDeliverResult> {
  const { target, streamId, chatType, trimmedText, streamStore } = params;
  if (!trimmedText.startsWith("{") || !trimmedText.includes('"template_card"')) {
    return { handled: false };
  }

  try {
    const parsed = JSON.parse(trimmedText) as {
      template_card?: {
        task_id?: string;
        main_title?: { title?: string; desc?: string };
        button_list?: Array<{ text?: string }>;
      };
    };
    if (!parsed.template_card) {
      return { handled: false };
    }

    const isSingleChat = chatType !== "group";
    const responseUrl = getActiveReplyUrl(streamId);

    if (responseUrl && isSingleChat) {
      await useActiveReplyOnce(streamId, async ({ responseUrl: url, proxyUrl }) => {
        const res = await wecomFetch(
          url,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              msgtype: "template_card",
              template_card: parsed.template_card,
            }),
          },
          { proxyUrl, timeoutMs: REQUEST_TIMEOUT_MS },
        );
        if (!res.ok) {
          throw new Error(`template_card send failed: ${res.status}`);
        }
      });
      target.runtime.log?.(
        `[webhook] sent template_card: task_id=${parsed.template_card.task_id}`,
      );
      const cardSentText = resolveWecomTemplates(target.account).cardSent;
      streamStore.updateStream(streamId, (s) => {
        s.finished = true;
        s.content = cardSentText;
      });
      target.statusSink?.({ lastOutboundAt: Date.now() });
      return { handled: true };
    }

    target.runtime.log?.(
      `[webhook] template_card fallback to text (group=${!isSingleChat}, hasUrl=${!!responseUrl})`,
    );
    const cardTitle = parsed.template_card.main_title?.title || "交互卡片";
    const cardDesc = parsed.template_card.main_title?.desc || "";
    const buttons =
      parsed.template_card.button_list?.map((b) => b.text).join(" / ") || "";
    const fallbackText = `📋 **${cardTitle}**${cardDesc ? `\n${cardDesc}` : ""}${buttons ? `\n\n选项: ${buttons}` : ""}`;
    return { handled: false, fallbackText };
  } catch {
    return { handled: false };
  }
}
