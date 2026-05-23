/**
 * WeCom 类型 barrel 导出（types/index）
 *
 * 对外统一 re-export 配置、账号、消息、常量类型，避免插件内深层 import 路径耦合。
 */

// 常量
export * from "./constants.js";

// 配置类型（仅导出被使用的子模块类型）
export type {
    WecomMediaConfig,
    WecomNetworkConfig,
    WecomBotConfig,
    WecomAgentConfig,
} from "./config.js";

// 账号类型
export type {
    ResolvedAgentAccount,
} from "./account.js";

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
} from "./message.js";
