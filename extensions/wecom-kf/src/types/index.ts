/**
 * WeCom 类型统一导出
 */

// 常量
export * from "./constants.js";

// 配置类型
export type {
    WecomAccountConfig,
    WecomKfAccountConfig,
    WecomKfConfig,
    WecomDmConfig,
    WecomMediaConfig,
    WecomNetworkConfig,
    WecomRoutingConfig,
    WecomBotConfig,
    WecomAgentConfig,
    WecomConfig,
} from "./config.js";

// 账号类型
export type {
    ResolvedWecomAccount,
    ResolvedBotAccount,
    ResolvedAgentAccount,
    ResolvedMode,
    ResolvedWecomAccounts,
} from "./account.js";

export type ServicerInfo = {
    userid: string;
    status: number;
    department_id?: number;
};

// 消息类型
export type {
    WecomBotInboundBase,
    WecomBotInboundText,
    WecomBotInboundVoice,
    WecomBotInboundVideo,
    WecomBotInboundStreamRefresh,
    WecomBotInboundEvent,
    WecomBotInboundMessage,
    WecomAgentInboundMessage,
    WecomInboundQuote,
    WecomTemplateCard,
    WecomOutboundMessage,
    KfMessage,
    AgentRouteParams,
    AgentRouteResult,
    InboundContextParams,
    InboundContext,
    ReplyDispatcherParams,
    ReplyDispatcher,
    DispatchReplyParams,
    SendTextParams,
    EventMessagesConfig,
} from "./message.js";

export type {
    GatewayRuntime,
    PluginApi,
    AgentInfo,
    StatsOverview,
} from "./channel.js";
