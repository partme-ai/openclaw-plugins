/**
 * Backward-compatible type bridge.
 * Canonical definitions live in `src/types/*`.
 *
 * 中文说明：这里只保留旧类型名到规范类型的映射，供历史调用方平滑迁移；不得在此
 * 增加独立字段，否则新旧协议模型会再次产生漂移。
 */
export type {
  WecomDmConfig,
  WecomAccountConfig,
  WecomConfig,
  ResolvedWecomAccount,
  WecomInboundQuote,
  WecomTemplateCard,
  WecomOutboundMessage,
  EventMessagesConfig,
  GatewayRuntime,
  AgentInfo,
  StatsOverview,
} from "./index.js";

import type {
  WecomBotInboundBase,
  WecomBotInboundText,
  WecomBotInboundVoice,
  WecomBotInboundStreamRefresh,
  WecomBotInboundEvent,
  WecomBotInboundMessage,
} from "./index.js";

export type WecomInboundBase = WecomBotInboundBase;
export type WecomInboundText = WecomBotInboundText;
export type WecomInboundVoice = WecomBotInboundVoice;
export type WecomInboundStreamRefresh = WecomBotInboundStreamRefresh;
export type WecomInboundEvent = WecomBotInboundEvent;
export type WecomInboundMessage = WecomBotInboundMessage;

export type WecomInboundTemplateCardEvent = WecomBotInboundEvent;
export type WecomTemplateCardEventPayload = {
  card_type: string;
  event_key: string;
  task_id: string;
  response_code?: string;
  selected_items?: {
    question_key?: string;
    option_ids?: string[];
  };
};
